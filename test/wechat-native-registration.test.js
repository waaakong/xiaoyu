import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';
import {registeredNativeBuild} from '../src/wechat-native-lifecycle.js';
test('component registration requires matching successful validation and rejects traversal',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'xy-registration-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));assert.equal(registeredNativeBuild(dir),null);
 const build=path.join(dir,'build-repair');fs.mkdirSync(build);fs.writeFileSync(path.join(build,'manifest.json'),JSON.stringify({dllSha256:'new'}));fs.writeFileSync(path.join(build,'validation.json'),JSON.stringify({nativeDll:'old',confirmed:true}));const register=value=>fs.writeFileSync(path.join(dir,'active-build.json'),JSON.stringify(value));register({directory:'build-repair',dllSha256:'new'});assert.throws(()=>registeredNativeBuild(dir),/MISMATCH/);
 fs.writeFileSync(path.join(build,'validation.json'),JSON.stringify({nativeDll:'new',confirmed:true}));assert.equal(registeredNativeBuild(dir),build);
 for(const directory of ['../build-repair','C:/other','build-repair/../build-repair']){register({directory,dllSha256:'new'});assert.throws(()=>registeredNativeBuild(dir),/DIRECTORY_INVALID/);}
});
