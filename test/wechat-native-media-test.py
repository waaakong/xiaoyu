import ctypes as c
import hashlib,json,os,socket,struct,sys,tempfile,unittest,urllib.request,urllib.error,uuid,shutil
from pathlib import Path
import importlib.util
ROOT=Path(__file__).resolve().parents[1]
BUILD=Path(os.environ.get('XIAOYU_NATIVE_BUILD',ROOT/'data/wechat-native-research/build-media'))
spec=importlib.util.spec_from_file_location('loader',ROOT/'scripts/load-wechat-native.py');loader=importlib.util.module_from_spec(spec);spec.loader.exec_module(loader)
TOKEN='b'*64


def packet(kind,name,file,data,sha=None,identifier=None):
    peer=b'filehelper';name=name.encode();file=file.encode()
    return struct.pack('<I36sIIIIQ32s',0x324d5958,str(identifier or uuid.uuid4()).encode(),kind,len(peer),len(name),len(file),len(data),sha or hashlib.sha256(data).digest())+peer+name+file


class MediaTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temporary=tempfile.TemporaryDirectory(dir=BUILD);cls.root=Path(cls.temporary.name)/'媒体';cls.root.mkdir()
        cls.path=Path(cls.temporary.name)/'MediaMock.dll';shutil.copyfile(BUILD/'XiaoyuWechatMock.dll',cls.path)
        cls.dll=c.WinDLL(str(cls.path));cls.dll.XiaoyuStart.argtypes=[c.c_void_p];cls.dll.XiaoyuStop.argtypes=[c.c_void_p];cls.dll.XiaoyuValidateMedia.argtypes=[c.c_void_p,c.c_uint]
        with socket.socket() as s:s.bind(('127.0.0.1',0));cls.port=s.getsockname()[1]
        cfg=loader.start_config(os.getpid(),cls.port,100,TOKEN,'wx_test',15,cls.root)
        assert cls.dll.XiaoyuStart(c.byref(cfg))==0

    @classmethod
    def tearDownClass(cls):
        assert cls.dll.XiaoyuStop(None)==0
        loader.k.FreeLibrary.argtypes=[c.c_void_p];loader.k.FreeLibrary(cls.dll._handle);cls.temporary.cleanup()

    def send(self,body):
        req=urllib.request.Request(f'http://127.0.0.1:{self.port}/media',data=body,headers={'Authorization':'Bearer '+TOKEN})
        try:
            with urllib.request.urlopen(req,timeout=5) as r:return r.status,json.load(r)
        except urllib.error.HTTPError as error:return error.code,json.load(error)

    def test_01_valid_owned_file_and_unicode_root(self):
        data=b'bounded local fixture';file=str(uuid.uuid4())+'.txt';(self.root/file).write_bytes(data)
        before=self.dll.XiaoyuTestCalls();self.assertEqual(self.send(packet(3,'验收.txt',file,data)),(200,{'state':'submitted'}));self.assertEqual(self.dll.XiaoyuTestCalls(),before+1)

    def test_02_wrong_hash_missing_file_or_wrong_size_never_call_native(self):
        data=b'content';file=str(uuid.uuid4())+'.txt';(self.root/file).write_bytes(data);before=self.dll.XiaoyuTestCalls()
        for body in [packet(3,'a.txt',file,data,sha=b'\0'*32),packet(3,'a.txt',str(uuid.uuid4())+'.txt',data),packet(3,'a.txt',file,b'different length')]:self.assertEqual(self.send(body)[0],500)
        self.assertEqual(self.dll.XiaoyuTestCalls(),before)

    def test_03_paths_types_and_lengths_are_rejected(self):
        for body in [packet(1,'a.png','../outside.png',b'x'),packet(2,'a.gif',str(uuid.uuid4())+'.png',b'x'),packet(4,'a.mp4',str(uuid.uuid4())+'.txt',b'x'),packet(3,'a/evil.txt',str(uuid.uuid4())+'.txt',b'x'),packet(9,'a.txt',str(uuid.uuid4())+'.txt',b'x')]:self.assertEqual(self.send(body)[0],400)

    def test_04_duplicate_media_id_does_not_call_native_twice(self):
        data=b'fixture';file=str(uuid.uuid4())+'.txt';(self.root/file).write_bytes(data);body=packet(3,'a.txt',file,data);before=self.dll.XiaoyuTestCalls()
        self.assertEqual(self.send(body)[0],200);self.assertEqual(self.send(body)[0],409);self.assertEqual(self.dll.XiaoyuTestCalls(),before+1)


if __name__=='__main__':unittest.main()
