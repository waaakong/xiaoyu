import test from 'node:test';import assert from 'node:assert/strict';import {execFile} from 'node:child_process';import {promisify} from 'node:util';import fs from 'node:fs';import path from 'node:path';
const exec=promisify(execFile),python=path.resolve('data/astrbot-env/Scripts/python.exe');
test('fast reader key reuse invalidates on salt, credential, file identity and time; poll backs off safely',{skip:!fs.existsSync(python)},async()=>{
 const code=`import importlib.util,tempfile,pathlib,threading
s=importlib.util.spec_from_file_location('fast','scripts/wechat-reader-fast.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
calls=[];clock=[0]
def derive(name,key,salt,secret):
 calls.append(1)
 return ('derived',pathlib.Path(name).read_bytes()[:16].hex())
cache=m.cached_deriver(derive,now=lambda:clock[0])
with tempfile.TemporaryDirectory() as directory:
 p=pathlib.Path(directory)/'message_0.db';p.write_bytes(b'a'*16+b'data')
 for _ in range(3):cache(str(p),'','','aa'*32)
 assert len(calls)==1
 p.write_bytes(b'a'*16+b'newdata');cache(str(p),'','','aa'*32);assert len(calls)==1
 p.write_bytes(b'b'*16);cache(str(p),'','','aa'*32);assert len(calls)==2
 cache(str(p),'','','bb'*32);assert len(calls)==3
 clock[0]=301;cache(str(p),'','','bb'*32);assert len(calls)==4
 other=pathlib.Path(directory)/'other.db';other.write_bytes(b'b'*16);cache(str(other),'','','bb'*32);assert len(calls)==5
 p.unlink();p.write_bytes(b'c'*16);cache(str(p),'','','bb'*32);assert len(calls)==6
class Stop:
 def wait(self,t):return t
 def is_set(self):return False
class Reader:
 clients={1};last_error='';count=1
 def selected_talkers(self):return list(range(self.count))
r=Reader();stop=m.AdaptiveStop(Stop(),r)
assert stop.wait(1)==.25
r.count=5;assert stop.wait(1)==1
r.count=1;r.last_error='failed';assert stop.wait(1)==1
r.last_error='';r.clients=set();assert stop.wait(1)==1
assert stop.wait(.5)==.5 and not stop.is_set()
print('ok')`;
 const r=await exec(python,['-B','-c',code],{windowsHide:true});assert.match(r.stdout,/ok/);
});
