import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {prepareHome} from '../src/codex.js';
test('local connection never modifies the existing Codex config or credentials',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qq-local-test-'));const home=path.join(dir,'codex');fs.mkdirSync(home);
  const file=path.join(home,'config.toml');fs.writeFileSync(file,'existing configuration');
  try{prepareHome({connectionMode:'local',codexHome:home,workspace:path.join(dir,'workspace')});assert.equal(fs.readFileSync(file,'utf8'),'existing configuration');assert.deepEqual(fs.readdirSync(home),['config.toml']);}
  finally{fs.rmSync(dir,{recursive:true,force:true});}
});
