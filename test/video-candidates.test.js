import test from 'node:test';
import assert from 'node:assert/strict';
import {douyinCardCandidates} from '../src/video-browser.js';
test('Douyin public waterfall/feed cards preserve exact IDs, reject malformed IDs and deduplicate',()=>{
  const card=(id,feed=null)=>({id,innerText:'公开作品标题',getAttribute:()=>feed,querySelector:()=>null});
  const doc={querySelectorAll:()=>[card('waterfall_item_7703638694100181925'),card('', '7703638694100181925'),card('waterfall_item_7702783704363568403'),card('waterfall_item_bad'),card('waterfall_item_7703638694100181925_suffix')]};
  const rows=douyinCardCandidates(doc);assert.equal(rows.length,2);assert.equal(rows[0].url,'https://www.douyin.com/video/7703638694100181925');assert.equal(rows[1].title,'公开作品标题');
});
test('Douyin jingxuan DIV href cards are recognized without reading framework state',()=>{
 const card=(href,title)=>({id:'',getAttribute:n=>n==='href'?href:null,querySelector:()=>({innerText:title})});
 const doc={querySelectorAll:()=>[card('//www.douyin.com/video/7704624317448024054','公开推荐'),card('https://www.douyin.com/video/7704624317448024054','重复'),card('https://evil.test/video/7704624317448024055','外站'),card('/video/7704624317448024056','另一个') ]};
 const rows=douyinCardCandidates(doc);assert.equal(rows.length,2);assert.equal(rows[0].title,'公开推荐');assert.equal(rows[1].url,'https://www.douyin.com/video/7704624317448024056');
});
