import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {NativeMediaLease,mediaPacket,nativeImageBytes} from '../src/wechat-native-media.js';
import sharp from 'sharp';
const fields={peer:'wx_friend',id:'12345678-1234-1234-1234-123456789abc',kind:'file',name:'验收.txt',basename:'12345678-1234-1234-1234-123456789abc.txt',size:10,sha256:'a'.repeat(64)};
test('WeChat preserves GIF bytes and the library sizing decision, and converts static sticker images',async()=>{
 const image=sharp({create:{width:400,height:20,channels:3,background:'#123456'}}),gif=await image.clone().gif({loop:3}).toBuffer(),png=await image.png().toBuffer();
 assert.deepEqual(await nativeImageBytes(gif,'sticker'),gif);const converted=await nativeImageBytes(png,'sticker'),meta=await sharp(converted).metadata();assert.equal(meta.format,'gif');assert.equal(meta.width,400);await assert.rejects(nativeImageBytes(png,'voice'),/MEDIA_INVALID/);
});
test('media packet matches native layout and rejects paths, malformed IDs and incompatible media types',()=>{
 const packet=mediaPacket(fields);assert.equal(packet.readUInt32LE(40),3);assert.equal(packet.readBigUInt64LE(56),10n);assert.equal(packet.subarray(64,96).toString('hex'),fields.sha256);
 for(const patch of [{peer:'../wrong'},{name:'../file.txt'},{basename:'../../file.txt'},{kind:'sticker'},{kind:'video'},{sha256:'invalid'},{size:20*1024*1024+1},{kind:'voice'}])assert.throws(()=>mediaPacket({...fields,...patch}),/MEDIA_INVALID/);
});
test('staging binds account and chat, expires, consumes once and never reads arbitrary paths',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'xy-media-'));t.after(()=>fs.rmSync(root,{force:true,recursive:true}));let now=1000;
 const owner=new NativeMediaLease(root,{now:()=>now}),p={bytes:Buffer.from('fixture'),kind:'file',name:'验收.txt',account:'wx_role',scope:'wechat:wx_role:private:wx_friend'};
 const lease=await owner.prepare(p);assert.ok(fs.existsSync(path.join(root,lease.basename)));
 assert.throws(()=>lease.consume({account:'wx_other',scope:p.scope}),/MEDIA_INVALID/);assert.throws(()=>lease.consume({account:p.account,scope:'wechat:wx_role:group:elsewhere@chatroom'}),/MEDIA_INVALID/);
 assert.ok(Buffer.isBuffer(lease.consume(p)));assert.throws(()=>lease.consume(p),/MEDIA_INVALID/);lease.dispose();
 const expired=await owner.prepare(p);now+=120001;assert.throws(()=>expired.consume(p),/MEDIA_INVALID/);expired.dispose();
 await assert.rejects(owner.prepare({...p,bytes:'C:/secrets.txt'}),/MEDIA_INVALID/);await assert.rejects(owner.prepare({...p,scope:'qq:wx_role:private:wx_friend'}),/MEDIA_INVALID/);
 await assert.rejects(owner.prepare({...p,assertFresh(){throw Error('revoked');}}),/revoked/);assert.equal(fs.readdirSync(root).length,0);
});
