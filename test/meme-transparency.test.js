import test from 'node:test';import assert from 'node:assert/strict';import sharp from 'sharp';import {imageInputs} from '../src/media.js';
for(const color of ['black','white'])test(`transparent custom sticker preserves ${color} lettering for model input`,async()=>{
 const original=await sharp(Buffer.from(`<svg width="180" height="80"><rect x="10" y="10" width="30" height="60" fill="${color}"/><text x="50" y="50" fill="${color}" font-size="30">TEST</text></svg>`)).png().toBuffer();
 const views=await imageInputs(original);assert.equal(views.length,1);assert.match(views[0].url,/^data:image\/png/);const output=Buffer.from(views[0].url.split(',')[1],'base64'),{data,info}=await sharp(output).raw().toBuffer({resolveWithObject:true});assert.equal(info.channels,3);const pixel=(x,y)=>data[(y*info.width+x)*3];assert.ok(Math.abs(pixel(20,20)-pixel(0,0))>40,'letter and background must remain distinct');assert.deepEqual((await sharp(output).metadata()).width,180);
});
test('opaque image retains exact small-text contrast and dimensions without JPEG artifacts',async()=>{
 const original=await sharp(Buffer.from('<svg width="100" height="40"><rect width="100" height="40" fill="white"/><rect x="10" y="10" width="1" height="20" fill="black"/></svg>')).png().toBuffer();const [image]=await imageInputs(original);const {data,info}=await sharp(Buffer.from(image.url.split(',')[1],'base64')).raw().toBuffer({resolveWithObject:true});assert.equal(data[(15*info.width+10)*3],0);assert.equal(data[(15*info.width+11)*3],255);
});
