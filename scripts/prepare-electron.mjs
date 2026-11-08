import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
const root=process.cwd(),build=path.join(root,'build'),backend=path.join(build,'backend');
if(path.dirname(backend)!==build)throw Error('Invalid staging directory');
fs.rmSync(backend,{recursive:true,force:true});
fs.mkdirSync(backend,{recursive:true});
const sumsFile=path.join(root,'data','packaging-cache','node-'+process.version+'-SHASUMS256.txt');
let sums;
if(fs.existsSync(sumsFile))sums=fs.readFileSync(sumsFile,'utf8');
else{
  const response=await fetch('https://nodejs.org/dist/'+process.version+'/SHASUMS256.txt');
  if(!response.ok)throw Error('Unable to verify official Node runtime');
  sums=await response.text();
}
const expected=sums.split(/\r?\n/).map(line=>line.trim().split(/\s+/)).find(parts=>parts[1]==='win-x64/node.exe')?.[0];
if(crypto.createHash('sha256').update(fs.readFileSync(process.execPath)).digest('hex')!==expected)throw Error('Node runtime SHA256 mismatch');

for(const dir of ['src','ui','personas','integrations','scripts','docs']){
  fs.cpSync(path.join(root,dir),path.join(backend,dir),{recursive:true,filter:p=>
    !p.split(path.sep).includes('node_modules')&&!p.includes('__pycache__')&&!p.endsWith('.pyc')&&!p.endsWith('cordis.patch.yml')});
}
for(const file of ['package.json','package-lock.json','persona.md','release-notes.json'])fs.copyFileSync(path.join(root,file),path.join(backend,file));
execFileSync(process.platform==='win32'?'npm.cmd':'npm',['ci','--omit=dev','--ignore-scripts'],{cwd:backend,stdio:'inherit',shell:process.platform==='win32'});
fs.cpSync(path.join(backend,'node_modules'),path.join(backend,'vendor-modules'),{recursive:true});
fs.mkdirSync(path.join(build,'runtime'),{recursive:true});
fs.copyFileSync(process.execPath,path.join(build,'runtime','node.exe'));
const licenseFile=path.join(root,'data','packaging-cache','node-'+process.version+'-LICENSE');
let license;
if(fs.existsSync(licenseFile))license=fs.readFileSync(licenseFile);
else{
  const response=await fetch('https://raw.githubusercontent.com/nodejs/node/'+process.version+'/LICENSE');
  if(!response.ok)throw Error('Unable to download Node.js license');
  license=Buffer.from(await response.arrayBuffer());
}
fs.writeFileSync(path.join(build,'runtime','Node.js-LICENSE.txt'),license);
console.log('Prepared Electron backend, verified Node runtime and license.');

