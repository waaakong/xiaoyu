import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {Runtime} from '../src/runtime.js';
import {Store} from '../src/store.js';
import {startGui} from '../src/gui.js';
test('dependency API requires window authentication and installs cannot overlap live plugins',async t=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'xy-dep-api-')),runtime=new Runtime({store:new Store(':memory:'),dataDir:dir});runtime.dependencies.runner=async()=>'';runtime.dependencies.canInstall=()=>false;runtime.dependencies.fetcher=()=>{throw Error('must not download while plugins run');};const gui=await startGui({open:false,autoConnect:false,runtime});t.after(async()=>{await gui.close();fs.rmSync(dir,{recursive:true,force:true});});const route=gui.origin+'/api/dependencies',headers={'x-session-token':gui.token,'content-type':'application/json'};assert.equal((await fetch(route)).status,403);assert.equal((await fetch(route,{headers:{...headers,origin:'https://example.com'}})).status,403);const report=await(await fetch(route,{headers})).json();assert.ok(report.items.some(i=>i.id==='astrbot'));assert.equal((await fetch(route+'/install',{method:'POST',headers,body:'{"index":"external"}'})).status,400);assert.equal((await fetch(route+'/install',{method:'POST',headers,body:'{"index":"official"}'})).status,200);await runtime.dependencies.work;assert.equal(runtime.dependencies.state().job.state,'failed');assert.match(runtime.dependencies.state().job.error,/正在运行/);assert.equal((await fetch(gui.origin+'/dependencies.js')).status,200);});
