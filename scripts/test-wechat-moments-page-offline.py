"""Tests only the mock DLL in this Python process, never in WeChat."""
import ctypes as c,json,struct,hashlib
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];base=ROOT/'data/wechat-comments-research/build-page-mock'
dll=c.WinDLL(str(base/'XiaoyuWechatMomentPageMock.dll'));validate=dll.XiaoyuMomentPageValidate;validate.argtypes=[c.c_void_p,c.c_uint];validate.restype=c.c_int
results=[]
def check(name,actual,expected):
 assert actual==expected,(name,actual,expected);results.append(name)
check('null packet',validate(None,0),0);request=b'12345678-1234-1234-1234-123456789abc'
for magic,expected in [(0x354d5958,1),(0x334d5958,0),(0x344d5958,0),(0x314d5958,0)]:
 packet=struct.pack('<I36sI',magic,request,1)+b'\x00';check('packet magic '+hex(magic),validate(c.create_string_buffer(packet),len(packet)),expected)
packet=struct.pack('<I36sI',0x354d5958,request,2)+b'\x00';check('truncated packet',validate(c.create_string_buffer(packet),len(packet)),0)
parse=dll.XiaoyuMomentPageParse;parse.argtypes=[c.c_void_p,c.c_uint,c.POINTER(c.c_uint64),c.POINTER(c.c_int32)];parse.restype=c.c_int;obj=c.c_uint64();ret=c.c_int32();data=bytes.fromhex('0a020800120b08ffffffffffffffffff01');check('response parser',parse(c.create_string_buffer(data),len(data),c.byref(obj),c.byref(ret)),1);check('response status',ret.value,0)
data=bytes.fromhex('0a05');check('truncated response',parse(c.create_string_buffer(data),len(data),c.byref(obj),c.byref(ret)),0)
callback=dll.XiaoyuMomentPageCompletionTest;callback.restype=c.c_int;check('inline callback ownership',callback(),1)
policy=dll.XiaoyuMomentPagePolicyTest;policy.restype=c.c_int;check('own account, first page and no comment request guards',policy(),15)
start=dll.XiaoyuMomentPageStart;start.argtypes=[c.c_void_p];start.restype=c.c_uint32;check('null start',start(None),1);check('zero config',start(c.create_string_buffer(bytes(424))),2)
def field(s,n):return s.encode()+bytes(n-len(s.encode()))
for name,reads,allow,expected in [('write mode refused',1,1,2),('multiple reads refused',2,0,2),('mock never dispatches',1,0,3)]:
 data=struct.pack('<4I65s129s129s65sII4xQ',0x374d5958,424,__import__('os').getpid(),12345,field('a'*64,65),field('wxid_self_test',129),field('wxid_self',129),field('0'*64,65),reads,allow,1);check(name,start(c.create_string_buffer(data)),expected)
(base/'offline-test-results.json').write_text(json.dumps({'passed':len(results),'dllSha256':hashlib.sha256((base/'XiaoyuWechatMomentPageMock.dll').read_bytes()).hexdigest(),'scope':'separate Python process; mock cannot dispatch native tasks','results':results},indent=2),encoding='utf-8');print(json.dumps({'passed':len(results),'loadedIntoWechat':False}))
