"""Exercise the actual C protocol against a mock that cannot invoke WeChat."""
import ctypes as c
import importlib.util
import json
import os
from pathlib import Path
import shutil
import socket
import struct
import tempfile
import unittest
import urllib.request
import urllib.error
import uuid
from concurrent.futures import ThreadPoolExecutor

ROOT=Path(__file__).resolve().parents[1]
BUILD=Path(os.environ.get('XIAOYU_NATIVE_BUILD',ROOT/'data/wechat-native-research/build'))
spec=importlib.util.spec_from_file_location('loader',ROOT/'scripts/load-wechat-native.py')
loader=importlib.util.module_from_spec(spec);spec.loader.exec_module(loader)
TOKEN='a'*64


def start_config(pid,port,limit,token,account):
    protocol=json.loads((BUILD/'manifest.json').read_text()).get('nativeProtocol',1)
    return loader.start_config(pid,port,limit,token,account) if protocol==2 else loader.TextConfig(0x314e5958,pid,port,limit,token.encode(),account.encode())


def payload(peer='filehelper',text='原生离线测试',identifier=None):
    peer=peer.encode();text=text.encode() if isinstance(text,str) else text
    return struct.pack('<I36sII',0x314e5958,str(identifier or uuid.uuid4()).encode(),len(peer),len(text))+peer+text


def free_port():
    with socket.socket() as sock:sock.bind(('127.0.0.1',0));return sock.getsockname()[1]


class BridgeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.dll=c.WinDLL(str(BUILD/'XiaoyuWechatMock.dll'))
        cls.dll.XiaoyuStart.argtypes=[c.c_void_p];cls.dll.XiaoyuStart.restype=c.c_uint32
        cls.dll.XiaoyuStop.argtypes=[c.c_void_p]
        cls.dll.XiaoyuValidate.argtypes=[c.c_void_p,c.c_uint]
        cls.dll.XiaoyuTestVerified.argtypes=[c.c_int]
        cls.port=free_port()
        config=start_config(os.getpid(),cls.port,64,TOKEN,'wx_test')
        assert cls.dll.XiaoyuStart(c.byref(config))==0

    @classmethod
    def tearDownClass(cls):
        assert cls.dll.XiaoyuStop(None)==0

    def request(self,body=None,token=TOKEN):
        route='/send' if body is not None else '/health'
        req=urllib.request.Request(f'http://127.0.0.1:{self.port}{route}',data=body,
            headers={'Authorization':'Bearer '+token,'Content-Type':'application/octet-stream'})
        try:
            with urllib.request.urlopen(req,timeout=4) as response:return response.status,json.load(response)
        except urllib.error.HTTPError as error:return error.code,json.load(error)

    def test_01_health_and_authentication(self):
        self.assertEqual(self.request()[0],200)
        self.assertEqual(self.request(token='b'*64)[0],401)

    def test_02_valid_submission_and_duplicate(self):
        message=payload()
        self.assertEqual(self.request(message),(200,{'state':'submitted'}))
        self.assertEqual(self.request(message)[0],409)

    def test_03_invalid_payloads_cannot_submit(self):
        before=self.request()[1]['submissions']
        for message in [b'bad',payload(text=b'\xff'),payload(text='a\0b'),payload(peer='../other'),
                        payload(text='x'*3001),payload()+b'extra']:
            self.assertEqual(self.request(message)[0],400)
        self.assertEqual(self.request()[1]['submissions'],before)

    def test_04_account_or_build_change_refuses_without_submission(self):
        before=self.request()[1]['submissions']
        self.dll.XiaoyuTestVerified(0)
        try:self.assertEqual(self.request(payload())[0],409)
        finally:self.dll.XiaoyuTestVerified(1)
        self.assertEqual(self.request()[1]['submissions'],before)

    def test_05_truncated_request_times_out_without_submission(self):
        before=self.request()[1]['submissions']
        with socket.create_connection(('127.0.0.1',self.port),timeout=4) as sock:
            sock.sendall(('POST /send HTTP/1.1\r\nAuthorization: Bearer '+TOKEN+'\r\nContent-Length: 100\r\n\r\nbad').encode())
            self.assertEqual(sock.recv(64),b'')
        self.assertEqual(self.request()[1]['submissions'],before)

    def test_06_token_in_body_is_not_authentication(self):
        before=self.request()[1]['submissions']
        body=('\r\nAuthorization: Bearer '+TOKEN+'\r\n').encode()
        with socket.create_connection(('127.0.0.1',self.port),timeout=4) as sock:
            sock.sendall(f'POST /send HTTP/1.1\r\nContent-Length: {len(body)}\r\n\r\n'.encode()+body)
            self.assertIn(b' 401 ',sock.recv(512))
        self.assertEqual(self.request()[1]['submissions'],before)

    def test_07_production_build_has_no_mock_export_and_refuses_other_host(self):
        production=c.WinDLL(str(BUILD/'XiaoyuWechatNative.dll'))
        with self.assertRaises(AttributeError):production.XiaoyuTestVerified
        config=start_config(os.getpid(),free_port(),1,TOKEN,'wx_test')
        production.XiaoyuStart.argtypes=[c.c_void_p]
        self.assertEqual(production.XiaoyuStart(c.byref(config)),3)

    def test_08_one_submission_trial_restricts_target_and_budget(self):
        with tempfile.TemporaryDirectory(dir=BUILD) as directory:
            target=Path(directory)/'OneTrial.dll';shutil.copyfile(BUILD/'XiaoyuWechatMock.dll',target)
            dll=c.WinDLL(str(target));dll.XiaoyuStart.argtypes=[c.c_void_p];dll.XiaoyuStop.argtypes=[c.c_void_p]
            port=free_port();cfg=start_config(os.getpid(),port,1,TOKEN,'wx_test')
            self.assertEqual(dll.XiaoyuStart(c.byref(cfg)),0)
            def post(body):
                req=urllib.request.Request(f'http://127.0.0.1:{port}/send',data=body,headers={'Authorization':'Bearer '+TOKEN})
                try:
                    with urllib.request.urlopen(req,timeout=4) as response:return response.status
                except urllib.error.HTTPError as error:return error.code
            try:
                self.assertEqual(post(payload(peer='wx_other')),403)
                self.assertEqual(post(payload()),200)
                self.assertEqual(post(payload()),409)
            finally:
                self.assertEqual(dll.XiaoyuStop(None),0)
                loader.k.FreeLibrary.argtypes=[c.c_void_p];loader.k.FreeLibrary(dll._handle)

    def test_09_loader_export_reader_excludes_mock_builds(self):
        exports=loader.export_rvas(BUILD/'XiaoyuWechatNative.dll')
        self.assertIn('XiaoyuStart',exports)
        self.assertIn('XiaoyuStop',exports)
        with self.assertRaisesRegex(OSError,'MOCK_DLL'):
            loader.export_rvas(BUILD/'XiaoyuWechatMock.dll')

    def test_10_lowercase_http_headers_and_concurrent_submissions(self):
        before=self.request()[1]['submissions'];message=payload()
        with socket.create_connection(('127.0.0.1',self.port),timeout=4) as sock:
            sock.sendall(('POST /send HTTP/1.1\r\nauthorization: Bearer '+TOKEN+
                          f'\r\ncontent-length: {len(message)}\r\n\r\n').encode()+message)
            self.assertIn(b' 200 ',sock.recv(512))
        with ThreadPoolExecutor(max_workers=4) as pool:
            results=list(pool.map(lambda _:self.request(payload())[0],range(4)))
        self.assertEqual(results,[200]*4)
        self.assertEqual(self.request()[1]['submissions'],before+5)


if __name__=='__main__':unittest.main()
