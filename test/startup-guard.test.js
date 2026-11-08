import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {snapshotUi} from '../src/ui-assets.js';

test('a running server serves an immutable UI revision instead of mixed source files',()=>{
  let value=Buffer.from('old module');const files={'/app.js':'app.js'},snapshot=snapshotUi(files,'/test',()=>value);value.fill(120);value=Buffer.from('new module importing a new route');files['/new.js']='new.js';
  assert.equal(snapshot.get('/app.js').toString(),'old module');assert.equal(snapshot.has('/new.js'),false);
});
function guard(){const classes=new Set(['app-booting']),events={},elements={bootMessage:{textContent:''},bootDetail:{hidden:true},bootRetry:{hidden:true}},timers=[];let reloads=0;const window={addEventListener:(name,fn)=>events[name]=fn},document={documentElement:{classList:{contains:x=>classes.has(x),add:x=>classes.add(x),remove:x=>classes.delete(x)}},querySelector:()=>({}),getElementById:id=>elements[id],addEventListener:(_n,fn)=>fn()};const code=fs.readFileSync(new URL('../ui/theme.js',import.meta.url),'utf8').split('// Startup guard intentionally')[1];
  vm.runInNewContext('// Startup guard intentionally'+code,{window,document,location:{href:'http://127.0.0.1/#private-window-token',reload:()=>reloads++},URL,setTimeout:fn=>{timers.push(fn);return timers.length;},clearTimeout(){}});return {classes,events,elements,timers,window,reloads:()=>reloads};}
test('failed ESM resource shows a retry and sanitized diagnostic without exposing auth fragments',()=>{
  const f=guard();f.events.error({target:{src:'http://127.0.0.1/scheduled-ui.js?secret=bad#private-window-token'}});assert.equal(f.classes.has('app-boot-failed'),true);assert.equal(f.elements.bootRetry.hidden,false);assert.match(f.elements.bootDetail.textContent,/scheduled-ui.js/);assert.doesNotMatch(f.elements.bootDetail.textContent,/secret|private-window-token/);f.elements.bootRetry.onclick();assert.equal(f.reloads(),1);
});
test('initialization stalls become recoverable and completed pages ignore later background errors',()=>{
  const f=guard();f.window.xyBootGuard.stage('读取本机设置');f.timers[0]();assert.match(f.elements.bootDetail.textContent,/读取本机设置/);assert.equal(f.classes.has('app-boot-failed'),true);f.window.xyBootGuard.complete();assert.equal(f.classes.has('app-boot-failed'),false);f.events.unhandledrejection({});assert.equal(f.classes.has('app-boot-failed'),false);
});
