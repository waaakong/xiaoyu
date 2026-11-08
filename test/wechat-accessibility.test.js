import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
const python=path.resolve('data/astrbot-env/Scripts/python.exe');
test('temporary accessibility experiment restores on interruption and refuses changed module state',{skip:!fs.existsSync(python)},async()=>{
  const code=`import importlib.util
s=importlib.util.spec_from_file_location('probe','scripts/wechat-accessibility-test.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
class Client:
 gate=123
 def __init__(self):self.value=0;self.writes=[];self.changed=False
 def write_gate(self,v):self.value=v;self.writes.append(v)
 def read(self,a,n):return bytes([self.value])
 def exited(self):return False
 def check_code(self):
  if self.changed:raise OSError('CORE_CODE_MISMATCH')
c=Client();reports=[]
def interrupt(_):raise RuntimeError('interrupted')
try:m.temporary_gate(c,0,1,interrupt,reports.append)
except RuntimeError:pass
assert c.writes==[1,0] and c.value==0 and reports[-1]['restored']
c=Client();reports=[]
def changed(_):c.changed=True
m.temporary_gate(c,0,1,changed,reports.append)
assert c.writes==[1] and reports[-1]['restored'] is False
c=Client();c.value=0
assert m.restore_gate(c,0)['restored'] and c.writes==[]
print('verified')`;
  const r=await promisify(execFile)(python,['-B','-c',code],{windowsHide:true});assert.equal(r.stdout.trim(),'verified');
});
