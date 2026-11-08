import sharp from 'sharp';

// At most six observed clips, two real frames each, in at most two labelled images.
// Keeps the same evidence visible to Codex and DSH (whose bridge accepts four images).
export async function videoContactSheets(items,readFrame){
 const sheets=[];
 for(let offset=0;offset<items.length;offset+=3){
  const tiles=[];let height=180;
  for(let row=offset;row<Math.min(items.length,offset+3);row++)for(let index=0;index<Math.min(2,items[row].observation.frames?.length??0);index++){
   const data=readFrame(items[row].id,index),meta=await sharp(data,{limitInputPixels:40000000}).metadata();if(!meta.width||!meta.height)throw Error('实际画面无法解码');height=Math.max(height,Math.min(480,Math.ceil(meta.height*480/meta.width)));tiles.push({data,row:row-offset,column:index,label:`Clip ${row+1} / Frame ${index+1}`});
  }
  if(!tiles.length)continue;const rows=Math.min(3,items.length-offset),cell=height+28,composite=[];
  for(const tile of tiles){const image=await sharp(tile.data,{limitInputPixels:40000000}).resize(480,height,{fit:'contain',background:'#102632',withoutEnlargement:false}).jpeg({quality:75}).toBuffer();composite.push({input:image,left:tile.column*480,top:tile.row*cell+28});composite.push({input:Buffer.from(`<svg width="480" height="28"><rect width="480" height="28" fill="#102632"/><text x="10" y="20" fill="white" font-size="16" font-family="sans-serif">${tile.label}</text></svg>`),left:tile.column*480,top:tile.row*cell});}
  sheets.push(await sharp({create:{width:960,height:rows*cell,channels:3,background:'#102632'}}).composite(composite).jpeg({quality:75}).toBuffer());
 }
 return sheets;
}
