import {spawn} from 'node:child_process';
import path from 'node:path';
import {root} from './config.js';
import {nativeExecutable} from './native-build.js';
const executable=nativeExecutable();
let host,closing=false;
const backend=spawn(process.execPath,[path.join(root,'src','gui.js'),'--no-open'],{cwd:root,windowsHide:true,stdio:['ignore','ignore','pipe','ipc']});
backend.stderr.on('data',()=>{});
const close=()=>{if(closing)return;closing=true;if(backend.connected)backend.send({type:'close'});const timer=setTimeout(()=>{backend.kill();host?.kill();},10000);timer.unref();};
backend.on('message',message=>{
  if(message.type==='closed'){closing=true;host?.kill();return;}
  if(message.type!=='ready'||host)return;
  host=spawn(executable,[root],{cwd:root,windowsHide:false,stdio:['pipe','ignore','pipe']});host.stderr.on('data',()=>{});host.stdin.on('error',()=>{});host.stdin.end(message.url+'\n');
  host.on('exit',close);host.on('error',close);
});
backend.on('exit',()=>{host?.kill();});backend.on('error',close);
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,close);
