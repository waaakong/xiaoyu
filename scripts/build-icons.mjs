import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
const root=path.resolve(import.meta.dirname,'..'),svg=fs.readFileSync(path.join(root,'ui/logo.svg')),sizes=[16,24,32,48,64,128,256];
const frames=[];for(const size of sizes){const bytes=await sharp(svg).resize(size,size).png().toBuffer();frames.push(bytes);fs.writeFileSync(path.join(root,'desktop',`icon-${size}.png`),bytes);if(size===256)fs.writeFileSync(path.join(root,'desktop/icon.png'),bytes);}
const header=Buffer.alloc(6+16*sizes.length);header.writeUInt16LE(1,2);header.writeUInt16LE(sizes.length,4);let offset=header.length;
frames.forEach((bytes,i)=>{const at=6+16*i;header[at]=sizes[i]===256?0:sizes[i];header[at+1]=header[at];header.writeUInt16LE(1,at+4);header.writeUInt16LE(32,at+6);header.writeUInt32LE(bytes.length,at+8);header.writeUInt32LE(offset,at+12);offset+=bytes.length;});
fs.writeFileSync(path.join(root,'desktop/icon.ico'),Buffer.concat([header,...frames]));console.log('Original SVG rendered to seven PNG sizes and multi-size ICO.');
