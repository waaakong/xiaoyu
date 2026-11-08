"""Mock DLL only. No WeChat handles or real native calls."""
import ctypes as c
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import socket
import struct
import tempfile
import unittest
import urllib.error
import urllib.request
import uuid
ROOT=Path(__file__).resolve().parents[1]
BUILD=ROOT/'data/wechat-native-research/build-voice'
spec=importlib.util.spec_from_file_location('loader',ROOT/'scripts/load-wechat-native.py')
loader=importlib.util.module_from_spec(spec);spec.loader.exec_module(loader)
TOKEN='b'*64


def packet(data,file=None,peer=b'filehelper',duration=20,sha=None,identifier=None):
    identifier=identifier or (file[:36] if file and len(file)==41 else str(uuid.uuid4()))
    file=(file or identifier+'.silk').encode()
    return struct.pack('<I36sIIII32s',0x31565958,identifier.encode(),len(peer),len(file),duration,len(data),sha or hashlib.sha256(data).digest())+peer+file


class VoiceNativeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp=tempfile.TemporaryDirectory(dir=BUILD)
        cls.root=Path(cls.temp.name)/'语音';cls.root.mkdir()
        target=Path(cls.temp.name)/'VoiceMock.dll';shutil.copyfile(BUILD/'XiaoyuWechatVoiceMock.dll',target)
        cls.dll=c.WinDLL(str(target));cls.dll.XiaoyuVoiceStart.argtypes=[c.c_void_p];cls.dll.XiaoyuVoiceStop.argtypes=[c.c_void_p]
        with socket.socket() as s:s.bind(('127.0.0.1',0));cls.port=s.getsockname()[1]
        cfg=loader.start_config(os.getpid(),cls.port,100,TOKEN,'wx_test',1,cls.root);cfg.magic=0x31565958
        assert cls.dll.XiaoyuVoiceStart(c.byref(cfg))==0

    @classmethod
    def tearDownClass(cls):
        assert cls.dll.XiaoyuVoiceStop(None)==0
        loader.k.FreeLibrary.argtypes=[c.c_void_p];loader.k.FreeLibrary(cls.dll._handle);cls.temp.cleanup()

    def request(self,body=None,route='/voice',token=TOKEN,origin=None):
        headers={'Authorization':'Bearer '+token}
        if origin:headers['Origin']=origin
        req=urllib.request.Request(f'http://127.0.0.1:{self.port}'+route,data=body,headers=headers)
        try:
            with urllib.request.urlopen(req,timeout=5) as r:return r.status,json.load(r)
        except urllib.error.HTTPError as e:return e.code,json.load(e)

    def owned(self,data=b'\x02#!SILK_V3\x01\x00x'):
        identifier=str(uuid.uuid4());file=identifier+'.silk';(self.root/file).write_bytes(data)
        return data,file,identifier

    def test_01_valid_owned_packet_once(self):
        data,file,identifier=self.owned();body=packet(data,file=file,identifier=identifier);before=self.dll.XiaoyuTestCalls()
        self.assertEqual(self.request(body)[0],200)
        self.assertEqual(self.request(body)[0],409)
        self.assertEqual(self.dll.XiaoyuTestCalls(),before+1)

    def test_02_hash_header_duration_rejected_before_native(self):
        data,file,_=self.owned();before=self.dll.XiaoyuTestCalls()
        for change in ({'sha':bytes(32)},{'duration':40},{'data':b'not silk data'}):
            data,file,_=self.owned()
            body=packet(change.get('data',data),file=file,**{k:v for k,v in change.items() if k!='data'})
            self.assertEqual(self.request(body)[0],500)
        self.assertEqual(self.dll.XiaoyuTestCalls(),before)

    def test_03_paths_nulls_and_lengths(self):
        data,file,_=self.owned()
        for body in (packet(data,file='../outside.silk'),packet(data,file=file,peer=b'wx\0evil'),packet(data,file=file,duration=19),packet(data,file=file,duration=30020),packet(data,file=file)+b'x'):
            self.assertEqual(self.request(body)[0],400)

    def test_04_auth_origin_and_route(self):
        data,file,_=self.owned();body=packet(data,file=file)
        self.assertEqual(self.request(body,token='a'*64)[0],401)
        self.assertEqual(self.request(body,origin='http://example.com')[0],400)
        self.assertEqual(self.request(body,route='/media')[0],404)

    def test_05_explicit_mock_health_and_identity_failure(self):
        status,body=self.request(route='/health');self.assertEqual(status,200);self.assertTrue(body['offlineTest']);self.assertEqual(body['integration'],'XiaoyuVoice-1')
        self.dll.XiaoyuTestVerified(0)
        try:self.assertEqual(self.request(route='/health')[0],409)
        finally:self.dll.XiaoyuTestVerified(1)


if __name__=='__main__':unittest.main()
