"""Offline protocol-2 @ tests; the mock cannot call WeChat code."""
import ctypes as c
import importlib.util
import json
import os
from pathlib import Path
import socket
import struct
import unittest
import urllib.request
import urllib.error
import uuid
ROOT=Path(__file__).resolve().parents[1]
BUILD=ROOT/'data/wechat-native-research/build-mentions'
spec=importlib.util.spec_from_file_location('loader',ROOT/'scripts/load-wechat-native.py')
loader=importlib.util.module_from_spec(spec);spec.loader.exec_module(loader)
TOKEN='a'*64
def packet(peer='100030003@chatroom',member='wxid_member',text='@测试\u2005原生定向测试',identifier=None):
 p=peer.encode();m=member.encode();t=text.encode()
 return struct.pack('<I36sIII',0x334e5958,str(identifier or uuid.uuid4()).encode(),len(p),len(t),len(m))+p+t+m
class MentionTests(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.dll=c.WinDLL(str(BUILD/'XiaoyuWechatMock.dll'))
  cls.dll.XiaoyuStart.argtypes=[c.c_void_p];cls.dll.XiaoyuStart.restype=c.c_uint32
  cls.dll.XiaoyuValidateMention.argtypes=[c.c_void_p,c.c_uint]
  cls.dll.XiaoyuStop.argtypes=[c.c_void_p]
  with socket.socket() as sock:sock.bind(('127.0.0.1',0));cls.port=sock.getsockname()[1]
  cls.start(16)
 @classmethod
 def start(cls,mask):
  config=loader.start_config(os.getpid(),cls.port,64,TOKEN,'wx_test',mask,ROOT/'data/wechat-native-research/outgoing')
  assert cls.dll.XiaoyuStart(c.byref(config))==0
 @classmethod
 def tearDownClass(cls):assert cls.dll.XiaoyuStop(None)==0
 def request(self,route,body=None,token=TOKEN):
  req=urllib.request.Request(f'http://127.0.0.1:{self.port}'+route,data=body,headers={'Authorization':'Bearer '+token,'Content-Type':'application/octet-stream'})
  try:
   with urllib.request.urlopen(req,timeout=4) as r:return r.status,json.load(r)
  except urllib.error.HTTPError as e:return e.code,json.load(e)
 def test_valid_group_member_and_replay(self):
  body=packet();self.assertEqual(self.request('/send-at',body),(200,{'state':'submitted'}));self.assertEqual(self.request('/send-at',body)[0],409)
 def test_capability_is_explicit(self):
  status,data=self.request('/health');self.assertEqual(status,200);self.assertTrue(data['nativeMentionSend']);self.assertFalse(data['capabilities']['images']);self.assertEqual(self.request('/send-at',packet(),token='b'*64)[0],401)
 def test_invalid_private_all_and_control_data(self):
  for body in [packet(peer='filehelper'),packet(member='all'),packet(member='wxid_a,wxid_b'),packet(member='wxid_a\n'),packet(text='bad\0text'),packet()[:-1]]:self.assertEqual(self.request('/send-at',body)[0],400)
 def test_disabled_mask_cannot_submit(self):
  self.dll.XiaoyuStop(None);self.start(0)
  try:self.assertEqual(self.request('/send-at',packet())[0],403)
  finally:self.dll.XiaoyuStop(None);self.start(16)
if __name__=='__main__':unittest.main()
