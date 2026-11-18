import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
const project=path.resolve(import.meta.dirname,'..');
export const LOCAL_EMBEDDING_MODEL='paraphrase-multilingual-MiniLM-L12-v2-int8';
export class LocalEmbeddings {
 constructor(base=path.join(project,'data')){this.base=base;this.tail=Promise.resolve();this.child=null;}
 installed(){return fs.existsSync(path.join(this.base,'memory-semantic','manifest.json'))&&fs.existsSync(this.python());}
 python(){return path.join(this.base,'memory-semantic','env',process.platform==='win32'?'Scripts/python.exe':'bin/python');}
 async start(){if(this.starting)return this.starting;if(this.child)return;if(!this.installed())throw Error('请先准备本地语义模型');this.starting=new Promise((resolve,reject)=>{const child=spawn(this.python(),['-I','-X','utf8',path.join(project,'scripts/memory-embedding-worker.py'),'--base',this.base],{windowsHide:true,stdio:['pipe','pipe','pipe'],env:{...process.env,TOKENIZERS_PARALLELISM:'false'}});this.child=child;let buffer='',ready=false;const timer=setTimeout(()=>{this.stop();reject(Error('本地语义模型加载超时'));},20000);child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>{buffer+=chunk;if(buffer.length>2000000){this.stop();return;}let at;while((at=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,at);buffer=buffer.slice(at+1);let d;try{d=JSON.parse(line);}catch{continue;}if(d.ready&&!ready){ready=true;clearTimeout(timer);resolve();}else if(this.pending?.id===d.id){const p=this.pending;this.pending=null;d.error?p.reject(Error('本地语义编码失败')):p.resolve(d.vectors);}}});child.stderr.resume();const failed=()=>{clearTimeout(timer);const owned=this.child===child;if(owned)this.child=null;if(!ready)reject(Error('本地语义进程未就绪'));if(owned){this.pending?.reject(Error('本地语义进程已退出'));this.pending=null;}};child.once('error',failed);child.once('exit',failed);}).finally(()=>{this.starting=null;});return this.starting;}
 embed(texts,{signal}={}){const work=async()=>{signal?.throwIfAborted();clearTimeout(this.idle);await this.start();signal?.throwIfAborted();const id=randomUUID();try{return await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.stop();reject(Error('本地语义编码超时'));},10000),abort=()=>{this.stop();reject(Error('本地语义编码取消'));};this.pending={id,resolve:v=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);resolve(v);},reject:e=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);reject(e);}};signal?.addEventListener('abort',abort,{once:true});this.child.stdin.write(JSON.stringify({id,texts})+'\n');});}finally{this.idle=setTimeout(()=>this.stop(),120000);this.idle.unref();}};const next=this.tail.then(work,work);this.tail=next.catch(()=>{});return next;}
 stop(){clearTimeout(this.idle);const child=this.child;this.child=null;this.pending?.reject(Error('本地语义进程已停止'));this.pending=null;child?.stdin.end();child?.kill();}
}
export const localEmbeddings=new LocalEmbeddings();
