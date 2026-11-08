import {inflateRawSync,crc32} from 'node:zlib';
export const MAX_ZIP=200*1024*1024;
export function safeEntry(name){
  if(typeof name!=='string'||name.length>1024||name.includes('\0')||name.includes('\\')||name.startsWith('/')||name.includes(':')||name.split('/').some(x=>x==='..'||x==='.')||/^[\s]/u.test(name))throw new Error('图包路径不安全');
  return name;
}
// Central-directory limits are checked before any DEFLATE allocation. No files are
// extracted by this parser; the importer only consumes known images/index metadata.
export function readZip(bytes,{maxEntryLength=32*1024*1024}={}){
  if(!Number.isSafeInteger(maxEntryLength)||maxEntryLength<1||maxEntryLength>MAX_ZIP)throw new Error('ZIP条目预算无效');
  if(!Buffer.isBuffer(bytes)||bytes.length>MAX_ZIP||bytes.length<22)throw new Error('ZIP最多200MB');
  let end=-1;for(let p=bytes.length-22;p>=Math.max(0,bytes.length-65557);p--)if(bytes.readUInt32LE(p)===0x06054b50&&p+22+bytes.readUInt16LE(p+20)===bytes.length){end=p;break;}
  if(end<0||bytes.readUInt16LE(end+4)||bytes.readUInt16LE(end+6))throw new Error('不支持多卷或无效ZIP');
  const count=bytes.readUInt16LE(end+10),offset=bytes.readUInt32LE(end+16),size=bytes.readUInt32LE(end+12);
  if(count>1600||count===65535||offset+size>end)throw new Error('ZIP条目过多或索引无效');
  let p=offset,total=0;const entries=new Map();
  for(let i=0;i<count;i++){
    if(p+46>end||bytes.readUInt32LE(p)!==0x02014b50)throw new Error('ZIP目录损坏');
    const flags=bytes.readUInt16LE(p+8),method=bytes.readUInt16LE(p+10),crc=bytes.readUInt32LE(p+16),compressed=bytes.readUInt32LE(p+20),length=bytes.readUInt32LE(p+24),n=bytes.readUInt16LE(p+28),extra=bytes.readUInt16LE(p+30),comment=bytes.readUInt16LE(p+32),external=bytes.readUInt32LE(p+38),local=bytes.readUInt32LE(p+42);
    if(p+46+n+extra+comment>offset+size)throw new Error('ZIP条目损坏');
    const name=safeEntry(bytes.subarray(p+46,p+46+n).toString('utf8'));p+=46+n+extra+comment;
    if(flags&1||![0,8].includes(method)||((external>>>16)&0xf000)===0xa000||entries.has(name))throw new Error('不支持加密、符号链接或重复路径');
    total+=length;if(total>MAX_ZIP||length>maxEntryLength||length>Math.max(compressed*200,1024*1024))throw new Error('ZIP解压大小或压缩比例超限');
    if(local+30>offset||bytes.readUInt32LE(local)!==0x04034b50)throw new Error('ZIP本地索引损坏');
    const localNameLength=bytes.readUInt16LE(local+26),localExtra=bytes.readUInt16LE(local+28),start=local+30+localNameLength+localExtra;
    if(start+compressed>offset||bytes.subarray(local+30,local+30+localNameLength).toString('utf8')!==name)throw new Error('ZIP路径或数据范围不匹配');
    entries.set(name,{name,length,read(){const data=bytes.subarray(start,start+compressed);const out=method===0?Buffer.from(data):inflateRawSync(data,{maxOutputLength:Math.max(1,length)});if(out.length!==length||crc32(out)!==crc)throw new Error('ZIP条目CRC校验失败');return out;}});
  }
  return entries;
}
export function writeZip(files){
  if(files.length>1600)throw new Error('图包条目过多');
  const chunks=[],central=[];let offset=0,total=0;
  for(const [entry,data]of files){const name=Buffer.from(safeEntry(entry),'utf8'),bytes=Buffer.from(data);total+=bytes.length;if(total>MAX_ZIP)throw new Error('导出图包最多200MB');const crc=crc32(bytes),head=Buffer.alloc(30);head.writeUInt32LE(0x04034b50);head.writeUInt16LE(20,4);head.writeUInt16LE(0x800,6);head.writeUInt32LE(crc,14);head.writeUInt32LE(bytes.length,18);head.writeUInt32LE(bytes.length,22);head.writeUInt16LE(name.length,26);chunks.push(head,name,bytes);
    const dir=Buffer.alloc(46);dir.writeUInt32LE(0x02014b50);dir.writeUInt16LE(20,4);dir.writeUInt16LE(20,6);dir.writeUInt16LE(0x800,8);dir.writeUInt32LE(crc,16);dir.writeUInt32LE(bytes.length,20);dir.writeUInt32LE(bytes.length,24);dir.writeUInt16LE(name.length,28);dir.writeUInt32LE(offset,42);central.push(dir,name);offset+=head.length+name.length+bytes.length;}
  const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(files.length,8);end.writeUInt16LE(files.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);const out=Buffer.concat([...chunks,directory,end]);if(out.length>MAX_ZIP)throw new Error('导出图包最多200MB');return out;
}
