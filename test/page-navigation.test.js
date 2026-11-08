import test from 'node:test';
import assert from 'node:assert/strict';
import {createPageNavigation} from '../ui/page-navigation.js';

const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
function setup(){let selected='overview',scroll=0,stops=0;const errors=[],pending=[];const nav=createPageNavigation({exists:id=>id!=='missing',select:id=>selected=id,readScroll:()=>scroll,writeScroll:n=>scroll=n,animate:()=>()=>stops++,loading:b=>pending.push(b),onError:e=>errors.push(e.message)});return {nav,errors,pending,get selected(){return selected;},get scroll(){return scroll;},set scroll(n){scroll=n;},get stops(){return stops;}};}

test('keeps current page during preparation and ignores late navigation',async()=>{const t=setup(),slow=deferred();const old=t.nav.go('wechat',async({isCurrent})=>{await slow.promise;return isCurrent();});assert.equal(t.selected,'overview');await t.nav.go('settings');assert.equal(t.selected,'settings');slow.resolve();assert.equal(await old,false);assert.equal(t.selected,'settings');assert.equal(t.pending.at(-1),false);});
test('failed preparation preserves the current page and can be retried',async()=>{const t=setup();assert.equal(await t.nav.go('wechat',async()=>{throw Error('offline');}),false);assert.equal(t.selected,'overview');assert.deepEqual(t.errors,['offline']);assert.equal(t.pending.at(-1),false);assert.equal(await t.nav.go('wechat',async()=>true),true);assert.equal(t.selected,'wechat');});
test('restores each page scroll without resetting the active page or overlapping tweens',async()=>{const t=setup();t.scroll=360;await t.nav.go('settings');assert.equal(t.scroll,0);t.scroll=80;await t.nav.go('settings');assert.equal(t.scroll,80);await t.nav.go('overview');assert.equal(t.scroll,360);await t.nav.go('settings');assert.equal(t.scroll,80);assert.ok(t.stops>=2);});
test('a destroyed navigation cannot commit pending work',async()=>{const t=setup(),slow=deferred();const promise=t.nav.go('wechat',()=>slow.promise);t.nav.destroy();slow.resolve(true);assert.equal(await promise,false);assert.equal(t.selected,'overview');});
