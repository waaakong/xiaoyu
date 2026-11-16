import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {validateMomentUiRequest,readMomentMedia,withMomentTrafficPaused} from '../src/wechat-moments-ui.js';

test('朋友圈界面请求：文字、图片、私密范围和演练默认值',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'xy-moments-ui-'));
  try{
    const image=path.join(dir,'a.png');fs.writeFileSync(image,'x');
    const video=path.join(dir,'b.mp4');fs.writeFileSync(video,'x');
    assert.deepEqual(validateMomentUiRequest({text:'  你好  '}),{text:'你好',media:[],privacy:'public',publish:false});
    assert.deepEqual(validateMomentUiRequest({media:[image],privacy:'private',publish:true}),{text:'',media:[image],privacy:'private',publish:true});
    assert.equal(validateMomentUiRequest({text:'视频',media:[video]}).media.length,1);
    assert.throws(()=>validateMomentUiRequest({media:[image,video]}),/不能在同一条/);
    assert.throws(()=>validateMomentUiRequest({media:['relative.png']}),/绝对路径/);
    assert.throws(()=>validateMomentUiRequest({}),/请填写正文/);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('朋友圈界面素材预览：图片缩略、视频元数据与路径校验',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'xy-moments-media-'));
  try{
    const image=path.join(dir,'a.png');fs.writeFileSync(image,Buffer.from('89504e470d0a1a0a','hex'));
    const video=path.join(dir,'b.mp4');fs.writeFileSync(video,Buffer.alloc(10));
    const picture=readMomentMedia(image);
    assert.equal(picture.kind,'image');
    assert.equal(picture.preview,true);
    assert.equal(picture.base64,Buffer.from('89504e470d0a1a0a','hex').toString('base64'));
    const movie=readMomentMedia(video);
    assert.equal(movie.kind,'video');
    assert.equal(movie.preview,false);
    assert.equal(movie.base64,undefined);
    assert.throws(()=>readMomentMedia('relative.png'),/绝对路径/);
    assert.throws(()=>readMomentMedia(path.join(dir,'a.txt')),/仅支持/);
    assert.throws(()=>readMomentMedia(path.join(dir,'missing.png')),/不存在/);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('朋友圈计划发布前暂停微信收发，发布后恢复',async()=>{
  let running=true,stops=0,starts=0,seen=null;
  const child={get running(){return running;},async stop(){stops++;running=false;},async start(){starts++;running=true;}};
  const result=await withMomentTrafficPaused({child},async()=>{seen=running;return {published:true};});
  assert.equal(result.published,true);
  assert.equal(seen,false);
  assert.equal(stops,1);assert.equal(starts,1);assert.equal(running,true);
});

test('朋友圈计划失败也会恢复微信收发，并保留原始错误',async()=>{
  let running=true,starts=0;
  const child={get running(){return running;},async stop(){running=false;},async start(){starts++;running=true;}};
  await assert.rejects(()=>withMomentTrafficPaused({child},async()=>{throw Error('发布控件不可用');}),/发布控件不可用/);
  assert.equal(starts,1);assert.equal(running,true);
});

test('朋友圈已发布但收发恢复失败时明确报告恢复失败',async()=>{
  let running=true;
  const child={get running(){return running;},async stop(){running=false;},async start(){throw Error('连接超时');}};
  await assert.rejects(()=>withMomentTrafficPaused({child},async()=>({published:true})),/朋友圈已发布，但微信收发恢复失败：连接超时/);
});

test('微信收发未运行时朋友圈计划不额外启停',async()=>{
  let stops=0,starts=0;
  const child={running:false,async stop(){stops++;},async start(){starts++;}};
  const result=await withMomentTrafficPaused({child},async()=>({published:true}));
  assert.equal(result.published,true);
  assert.equal(stops,0);assert.equal(starts,0);
});
