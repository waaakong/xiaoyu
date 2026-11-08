import test from 'node:test';
import assert from 'node:assert/strict';
import {startGui} from '../src/gui.js';
import {Runtime} from '../src/runtime.js';
import {Store} from '../src/store.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
test('GUI serves local assets, requires token and rejects cross-origin calls',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qq-gui-test-'));
  const gui=await startGui({open:false,autoConnect:false,runtime:new Runtime({store:new Store(':memory:'),dataDir:dir})});
  try{
    const html=await (await fetch(gui.origin)).text();assert.match(html,/type="module"/);assert.match(html,/data-page="personas"/);
    for(const route of ['/theme.js','/workbench.css','/logo.svg','/icons.svg','/wechat-chat-controls.js','/companion-ui.js','/companion.css','/moments-ui.js','/publishing-ui.js','/life-ui.js']){const response=await fetch(gui.origin+route);assert.equal(response.status,200);if(route.endsWith('.svg'))assert.match(response.headers.get('content-type'),/image\/svg\+xml/);}
    assert.equal((await fetch(gui.origin+'/api/state')).status,403);
    assert.equal((await fetch(gui.origin+'/api/wechat/moments')).status,403);
    assert.equal((await fetch(gui.origin+'/api/wechat/moments/confirm',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({confirm:true})})).status,403);
    const headers={'X-Session-Token':gui.token};assert.equal((await fetch(gui.origin+'/memes.js')).status,200);assert.equal((await fetch(gui.origin+'/web.js')).status,200);assert.equal((await fetch(gui.origin+'/api/web/browser/preview')).status,403);assert.equal((await fetch(gui.origin+'/api/web/browser/enable',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({enabled:'yes'})})).status,404);assert.equal((await fetch(gui.origin+'/api/packs/export?id=local')).status,403);const catalog=await(await fetch(gui.origin+'/api/catalog',{headers})).json();assert.ok(catalog.libraries.some(l=>l.id==='local'));assert.equal((await fetch(gui.origin+'/api/packs/import-zip',{method:'POST',headers:{...headers,'Content-Type':'text/plain'},body:'bad'})).status,400);
    for(const file of ['memory-star-map.js','memory-star-map.css','star-map-canvas.js','liquid.css','workspace-copy.js','workspace-motion.js'])assert.equal((await fetch(gui.origin+'/'+file)).status,200);
    assert.equal((await fetch(gui.origin+'/api/cognition/star-map')).status,403);
    const stars=await(await fetch(gui.origin+'/api/cognition/star-map',{headers})).json();assert.equal(stars.platform,'qq');assert.equal(stars.readOnly,true);assert.ok(Array.isArray(stars.nodes));
    assert.equal((await fetch(gui.origin+'/api/cognition/star-map?scope=wechat:wxid_a:private:wxid_b',{headers})).status,400);
    assert.equal((await fetch(gui.origin+'/api/cognition/star-map',{headers:{...headers,Origin:'https://example.com'}})).status,403);
    assert.equal((await fetch(gui.origin+'/api/state',{headers})).status,200);
    assert.equal((await fetch(gui.origin+'/api/state',{headers:{...headers,Origin:'https://example.com'}})).status,403);
    for(const route of ['awareness','emotions','life','video'])assert.equal((await fetch(gui.origin+'/api/'+route)).status,403);
    const sense=await(await fetch(gui.origin+'/api/awareness',{headers})).json();assert.equal(sense.privacy.clipboard,false);assert.equal(sense.privacy.screen,false);
    const emotions=await(await fetch(gui.origin+'/api/emotions',{headers})).json();assert.equal(emotions.platform,'qq');assert.deepEqual(emotions.states,[]);
    const setMood=await fetch(gui.origin+'/api/emotions/save',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({scope:'qq:99:private:10',personaId:'default',enabled:false,expressionStyle:'off'})});assert.equal(setMood.status,200);assert.equal((await setMood.json()).enabled,false);
    assert.equal((await fetch(gui.origin+'/api/emotions/save',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({scope:'wechat:wxid_a:private:wxid_b',personaId:'default',enabled:true})})).status,400);
    const settings=await (await fetch(gui.origin+'/api/settings',{headers})).json();assert.ok(settings.config.onebotToken.length>=24);
    assert.equal((await fetch(gui.origin+'/api/settings',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({config:{allowedUsers:['not a QQ number']},persona:'test'})})).status,400);
    assert.equal((await fetch(gui.origin+'/memory.js')).status,200);
    assert.equal((await fetch(gui.origin+'/api/memory/versions?id=1')).status,403);
    const probe=await fetch(gui.origin+'/api/memory/preview',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({scope:'qq:99:private:10',query:'以前的饮料'})});assert.equal(probe.status,200);assert.equal((await probe.json()).chars,0);
    const group=await fetch(gui.origin+'/api/memory/preview',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({scope:'qq:99:group:20',query:'饮料'})});assert.equal(group.status,400);
  }finally{await gui.close();fs.rmSync(dir,{recursive:true,force:true});}
});
