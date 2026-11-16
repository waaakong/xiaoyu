"""Load only the offline mock into this Python process. No injection/network."""
import ctypes as C
import hashlib
import hmac
import json
import struct
import time
import uuid
from pathlib import Path

root = Path(__file__).resolve().parent.parent
mock = root / 'data/wechat-comments-research/build-service-mock/XiaoyuWechatMomentsServiceMock.dll'
lib = C.WinDLL(str(mock))
auth = lib.XiaoyuMomentsServiceAuthorize
auth.argtypes = [C.c_void_p, C.c_uint, C.c_char_p]
auth.restype = C.c_int
lib.XiaoyuMomentsServiceMockConfigure.argtypes = [C.c_uint, C.c_uint]
lib.XiaoyuMomentsServiceMockAdmit.argtypes = [C.c_void_p, C.c_uint]
lib.XiaoyuMomentsServiceParse.argtypes = [C.c_void_p, C.c_uint, C.POINTER(C.c_uint64), C.POINTER(C.c_long)]

def var(v):
    out = bytearray()
    while True:
        out.append((v & 127) | (128 if v > 127 else 0))
        v >>= 7
        if not v:
            return bytes(out)

def num(k, v):
    return var(k * 8) + var(v)

def blob(k, v):
    v = v.encode() if isinstance(v, str) else v
    return var(k * 8 + 2) + var(len(v)) + v

def packet(magic, body):
    return struct.pack('<I36sI', magic, str(uuid.uuid4()).encode(), len(body)) + body

def comment(obj=123, sender='wxid_test', kind=2, created=None, text='收到啦'):
    action = blob(1, sender) + blob(2, 'wxid_friend') + num(5, kind) + num(7, int(time.time()) if created is None else created) + blob(8, text)
    return packet(0x344d5958, blob(1, b'') + blob(2, num(1, obj) + blob(3, action)))

def signed(p):
    return hmac.new(bytes.fromhex('a' * 64), p, hashlib.sha256).hexdigest().encode()

passed = []
def check(name, condition):
    assert condition, name
    passed.append(name)

check('valid mock configuration', lib.XiaoyuMomentsServiceMockConfigure(2, 2) == 1)
p = comment()
check('valid HMAC and own object', auth(p, len(p), signed(p)) == 1)
check('missing signature rejected', auth(p, len(p), None) == 0)
check('wrong signature rejected', auth(p, len(p), b'0' * 64) == 0)
altered = p[:-1] + bytes([p[-1] ^ 1])
check('tampered body rejected', auth(altered, len(altered), signed(p)) == 0)
for name, q in [('foreign object', comment(obj=456)), ('foreign sender', comment(sender='wxid_other')), ('non-comment action', comment(kind=1)), ('stale action', comment(created=int(time.time())-1000)), ('future action', comment(created=int(time.time())+400)), ('empty body', comment(text='')), ('long body', comment(text='x'*513))]:
    check(name + ' rejected', auth(q, len(q), signed(q)) == 0)
page = lambda who: packet(0x354d5958, blob(3, who)+num(4, 0)+num(5, 0)+num(6, 0))
q = page('wxid_test')
check('own page accepted', auth(q, len(q), None) == 1)
q = page('wxid_other')
check('foreign page rejected', auth(q, len(q), None) == 0)
q = packet(0x334d5958, blob(1, b'')+num(2, 123)+num(3, 0))
check('detail shape accepted', auth(q, len(q), None) == 1)
check('first admission', lib.XiaoyuMomentsServiceMockAdmit(p, len(p)) == 1)
check('replay denied', lib.XiaoyuMomentsServiceMockAdmit(p, len(p)) == 0)
p2, p3 = comment(), comment()
check('second admission', lib.XiaoyuMomentsServiceMockAdmit(p2, len(p2)) == 1)
check('write budget enforced', lib.XiaoyuMomentsServiceMockAdmit(p3, len(p3)) == 0)
check('first read admission', lib.XiaoyuMomentsServiceMockAdmit(q, len(q)) == 1)
q2 = page('wxid_test')
check('second read admission', lib.XiaoyuMomentsServiceMockAdmit(q2, len(q2)) == 1)
q3 = page('wxid_test')
check('read budget enforced', lib.XiaoyuMomentsServiceMockAdmit(q3, len(q3)) == 0)
check('native completion ownership', lib.XiaoyuMomentsServiceCompletionTest() == 1)
oid, ret = C.c_uint64(), C.c_long()
data = blob(1, num(1, 0))
check('bounded response parse', lib.XiaoyuMomentsServiceParse(data, len(data), C.byref(oid), C.byref(ret)) == 1 and ret.value == 0)
data = b'\x0a\x7f'
check('truncated response rejected', lib.XiaoyuMomentsServiceParse(data, len(data), C.byref(oid), C.byref(ret)) == 0)
check('invalid start config rejected', lib.XiaoyuMomentsServiceStart(C.create_string_buffer(424)) == 2)
print(json.dumps({'passed': len(passed), 'checks': passed, 'mockOnly': True}))
