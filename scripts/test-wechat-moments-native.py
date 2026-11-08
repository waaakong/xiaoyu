"""Offline codec/validator tests in this Python process; no injection or server start."""
import ctypes as c
import hashlib
import json
from pathlib import Path
import struct
import unittest
ROOT=Path(__file__).resolve().parents[1]
class NativeMomentsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        base=ROOT/'data/wechat-moments-research/build-mock';m=json.loads((base/'manifest.json').read_text());dll=base/'XiaoyuWechatMomentsMock.dll'
        assert m['offlineTest'] is True and hashlib.sha256(dll.read_bytes()).hexdigest()==m['dllSha256']
        cls.dll=c.WinDLL(str(dll));cls.dll.XiaoyuMomentsValidate.argtypes=[c.c_void_p,c.c_uint];cls.dll.XiaoyuMomentsValidate.restype=c.c_int
        cls.dll.XiaoyuMomentsParse.argtypes=[c.c_void_p,c.c_uint,c.POINTER(c.c_uint64),c.POINTER(c.c_long)];cls.dll.XiaoyuMomentsParse.restype=c.c_int
    def parse(self,hex):
        data=bytes.fromhex(hex);id=c.c_uint64();ret=c.c_long();ok=self.dll.XiaoyuMomentsParse(data,len(data),c.byref(id),c.byref(ret));return ok,id.value,ret.value
    def test_full_precision(self):self.assertEqual(self.parse('0a020800120b08feffffffffffffffff01'),(1,18446744073709551614,0))
    def test_error_response(self):self.assertEqual(self.parse('0a0b08ffffffffffffffffff01'),(1,0,-1))
    def test_missing_object_is_not_id(self):self.assertEqual(self.parse('0a020800'),(1,0,0))
    def test_completion_callback_ownership(self):
        self.dll.XiaoyuMomentsCompletionTest.argtypes=[];self.dll.XiaoyuMomentsCompletionTest.restype=c.c_int
        self.assertEqual(self.dll.XiaoyuMomentsCompletionTest(),1)
    def test_malformed(self):
        for value in ['','0a08','0a0208','12020801','00','0b','08ffffffffffffffffffff02']:
            with self.subTest(value=value):self.assertEqual(self.parse(value)[0],0)
    def test_packet_size_uuid_and_magic(self):
        payload=b'\x0a\x00';valid=struct.pack('<I36sI',0x314d5958,b'12345678-1234-1234-1234-123456789012',len(payload))+payload
        self.assertEqual(self.dll.XiaoyuMomentsValidate(valid,len(valid)),1)
        for data in [valid[:-1],valid+b'x',b'xxxx'+valid[4:],valid[:4]+b'!'*36+valid[40:]]:self.assertEqual(self.dll.XiaoyuMomentsValidate(data,len(data)),0)
if __name__=='__main__':unittest.main()
