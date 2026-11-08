import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
const python=path.resolve('data/astrbot-env/Scripts/python.exe'),exec=promisify(execFile);
test('reader process discovery rejects path confusion, multiple instances and cyclic process trees',{skip:!fs.existsSync(python)},async()=>{
  const code=`import importlib.util
s=importlib.util.spec_from_file_location('helper','scripts/wechat-reader-setup.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
exe='C:/Program Files/Tencent/Weixin/Weixin.exe'
def p(pid,parent,file=exe):return {'ProcessId':pid,'ParentProcessId':parent,'ExecutablePath':file}
assert m.matching_roots([p(10,1),p(11,10),p(12,10)],exe)==[10]
assert m.matching_roots([p(10,1),p(20,1)],exe)==[10,20]
assert m.matching_roots([p(10,1,'C:/other/Weixin.exe')],exe)==[]
try:m.matching_roots([p(10,11),p(11,10),p(20,1)],exe)
except ValueError:pass
else:raise AssertionError('cycle must be rejected even with another valid process')
print('verified')`;
  const r=await exec(python,['-B','-c',code],{windowsHide:true});assert.equal(r.stdout.trim(),'verified');
});
test('live account evidence accepts only database handles inside an account db_storage tree',{skip:!fs.existsSync(python)},async()=>{
  const code=`import importlib.util
s=importlib.util.spec_from_file_location('probe','scripts/wechat-live-account.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
assert m.account_from_path('C:/data/xwechat_files/wx_a_hash/db_storage/message/message_0.db')=='wx_a_hash'
assert m.account_from_path('C:/data/xwechat_files/wx_a_hash/db_storage/message/message_0.db-wal')=='wx_a_hash'
assert m.account_from_path('C:/data/xwechat_files/wx_a_hash/other/message_0.db') is None
assert m.account_from_path('C:/data/not_xwechat_files/wx_a_hash/db_storage/message_0.db') is None
assert m.account_from_path('C:/data/xwechat_files/wx_a_hash/db_storage/something.txt') is None
print('verified')`;
  const r=await exec(python,['-B','-c',code],{windowsHide:true});assert.equal(r.stdout.trim(),'verified');
});
