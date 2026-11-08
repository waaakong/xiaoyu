"""Mock DLL checks only. Never opens or loads code into WeChat."""
import ctypes as c
import json
import os
from pathlib import Path
import socket
import struct
import time
import unittest
import urllib.error
import urllib.request
import uuid
ROOT=Path(__file__).resolve().parents[1]
TOKEN='a'*64

def packet(kind=1,peer='filehelper',payload=None,target='',request_id=None):
    if payload is None:payload='<appmsg><title>验收</title><type>'+str(57 if kind==1 else 19)+'</type></appmsg>' if kind!=3 else ''
    p,b,t=peer.encode(),payload.encode(),target.encode();identity=(request_id or str(uuid.uuid4())).encode()
    return struct.pack('<II36sIII',0x34535958,kind,identity,len(p),len(b),len(t))+p+b+t
def varint(n):
    out=b''
    while n>127:out+=bytes([(n&127)|128]);n>>=7
    return out+bytes([n])
def number(key,value):return varint(key<<3)+varint(value)
def field(key,value):return varint((key<<3)|2)+varint(len(value))+value

class SocialNative(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        build=ROOT/'data/wechat-social-research/build-mock';manifest=json.loads((build/'manifest.json').read_text())
        if manifest.get('offlineTest') is not True:raise RuntimeError('Refusing non-mock DLL')
        cls.dll=c.WinDLL(str(build/'XiaoyuWechatSocialMock.dll'))
        cls.dll.XiaoyuSocialValidate.argtypes=[c.c_void_p,c.c_uint];cls.dll.XiaoyuSocialValidate.restype=c.c_int
        cls.dll.XiaoyuSocialEncode.argtypes=[c.c_void_p,c.c_uint,c.c_void_p,c.c_uint];cls.dll.XiaoyuSocialEncode.restype=c.c_uint
        cls.dll.XiaoyuSocialParse.argtypes=[c.c_void_p,c.c_uint,c.c_uint,c.POINTER(c.c_uint64),c.POINTER(c.c_long)];cls.dll.XiaoyuSocialParse.restype=c.c_int
        cls.dll.XiaoyuSocialStart.argtypes=[c.c_void_p];cls.dll.XiaoyuSocialStart.restype=c.c_uint
        with socket.socket() as sock:sock.bind(('127.0.0.1',0));cls.port=sock.getsockname()[1]
        def text(value,n):return value.encode()+b'\0'*(n-len(value.encode()))
        cfg=struct.pack('<5I65s129s129s129s129s3x',0x32535958,604,os.getpid(),cls.port,3,text(TOKEN,65),text('wx_test_17fa',129),text('wx_test',129),text('10@chatroom',129),text('wx_other',129))
        if cls.dll.XiaoyuSocialStart(cfg)!=0:raise RuntimeError('mock start failed')
        for _ in range(20):
            try:cls.request('/health');break
            except OSError:time.sleep(.05)
    @classmethod
    def tearDownClass(cls):cls.dll.XiaoyuSocialStop(None)
    @classmethod
    def request(cls,path,data=None,token=TOKEN):
        req=urllib.request.Request('http://127.0.0.1:'+str(cls.port)+path,data=data,headers={'Authorization':'Bearer '+token})
        with urllib.request.urlopen(req,timeout=3) as r:return json.load(r)
    def test_codec_and_validation(self):
        valid=packet();self.assertEqual(self.dll.XiaoyuSocialValidate(valid,len(valid)),1)
        for value in [valid[:-1],b'\0'*56,packet(peer='../../other'),packet(payload='<appmsg><type>57</type><!DOCTYPE x></appmsg>'),packet(payload='<appmsg><type>19</type></appmsg>'),packet(kind=3,target='')]:self.assertEqual(self.dll.XiaoyuSocialValidate(value,len(value)),0)
        out=c.create_string_buffer(65536);n=self.dll.XiaoyuSocialEncode(valid,len(valid),out,len(out));self.assertGreater(n,0);self.assertIn(b'wx_test',out.raw[:n]);self.assertIn(b'filehelper',out.raw[:n]);self.assertIn('验收'.encode(),out.raw[:n])
        self.assertEqual(self.dll.XiaoyuSocialEncode(valid,len(valid),out,3),0)
    def test_lossless_receipt_and_rejection(self):
        server_id=c.c_uint64();ret=c.c_long();message=field(1,number(1,0))+number(9,2**64-2)
        self.assertEqual(self.dll.XiaoyuSocialParse(message,len(message),1,c.byref(server_id),c.byref(ret)),1);self.assertEqual(server_id.value,2**64-2);self.assertEqual(ret.value,0)
        message=field(1,number(1,2**64-2));self.assertEqual(self.dll.XiaoyuSocialParse(message,len(message),1,c.byref(server_id),c.byref(ret)),1);self.assertEqual(ret.value,-2)
        for message in [b'\x80',b'\x0a\xff',b'\x0a\x08\x01']:
            self.assertEqual(self.dll.XiaoyuSocialParse(message,len(message),1,c.byref(server_id),c.byref(ret)),0)
    def test_http_auth_target_dedup_limit_and_promotion(self):
        with self.assertRaises(urllib.error.HTTPError) as e:self.request('/health',token='b'*64)
        self.assertEqual(e.exception.code,403)
        with self.assertRaises(urllib.error.HTTPError) as e:self.request('/submit',packet(peer='wx_unapproved'))
        self.assertEqual(e.exception.code,403);self.assertEqual(self.request('/health')['submissions'],0)
        first=packet();self.assertEqual(self.request('/submit',first)['state'],'server-accepted')
        with self.assertRaises(urllib.error.HTTPError) as e:self.request('/submit',first)
        self.assertEqual(e.exception.code,409)
        self.assertEqual(self.request('/submit',packet(kind=2))['ret'],0)
        with self.assertRaises(urllib.error.HTTPError) as e:self.request('/activate',b'')
        self.assertEqual(e.exception.code,409)
        self.assertEqual(self.request('/submit',packet(kind=3,peer='10@chatroom',target='wx_other'))['ret'],0)
        with self.assertRaises(urllib.error.HTTPError) as e:self.request('/submit',packet())
        self.assertEqual(e.exception.code,429);self.assertEqual(self.request('/health')['submissions'],3)
        self.assertEqual(self.request('/activate',b'')['limit'],512)

if __name__=='__main__':unittest.main()
