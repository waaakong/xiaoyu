import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {qqImageUrl} from './media.js';
export const MAX_VIDEO=50*1024*1024;
export function videoRange(text=''){const m=/视频片段\s*(\d+(?:\.\d+)?)\s*[-—至]\s*(\d+(?:\.\d+)?)\s*秒/u.exec(text);if(!m)return {};const start=Number(m[1]),end=Number(m[2]);if(end<=start||end-start>180)throw Error('视频片段须为正向范围，最多180秒');return {start,end};}
export async function videoBytes(segment,io,{signal}={}){
 if(io.readVideo)return io.readVideo(segment.data?.file,{signal});
 // Incoming messages cannot nominate arbitrary local paths or arbitrary hosts.
 let url=segment.data?.url;
 if(!url&&segment.data?.file){const info=await io.action('get_file',{file_id:segment.data.file},{signal});url=info?.url;}
 if(!url)throw Error('协议未提供视频下载地址，请重新发送原视频');
 const res=await fetch(qqImageUrl(url),{redirect:'error',signal:AbortSignal.any([...(signal?[signal]:[]),AbortSignal.timeout(30000)])});
 if(!res.ok||Number(res.headers.get('content-length'))>MAX_VIDEO){await res.body?.cancel();throw Error('视频下载失败或超过50MB，请压缩后重发');}
 const chunks=[];let size=0;for await(const chunk of res.body){size+=chunk.length;if(size>MAX_VIDEO){await res.body.cancel();throw Error('视频超过50MB，请压缩后重发');}chunks.push(chunk);}return Buffer.concat(chunks);
}
export async function videoSheets(frames){const sheets=[];for(let offset=0;offset<frames.length;offset+=3){const group=frames.slice(offset,offset+3),layers=[];for(let i=0;i<group.length;i++){const f=group[i];if(!Number.isFinite(f.at))throw Error("视频时间点无效");const raw=Buffer.from(f.base64,"base64");if(raw.length>5*1024*1024)throw Error("视频帧过大");const input=await sharp(raw,{limitInputPixels:20000000}).resize(640,360,{fit:"contain",background:"#101820"}).jpeg().toBuffer();layers.push({input,left:0,top:i*390+30},{input:Buffer.from(`<svg width="640" height="30"><text x="10" y="23" fill="white" font-size="20">t=${f.at}s</text></svg>`),left:0,top:i*390});}const bytes=await sharp({create:{width:640,height:group.length*390,channels:3,background:"#101820"}}).composite(layers).jpeg({quality:78}).toBuffer();sheets.push({type:"image",url:"data:image/jpeg;base64,"+bytes.toString("base64"),detail:"auto"});}return sheets;}
export class ChatVideo {
 constructor(speech,{runner=null}={}){this.speech=speech;this.runner=runner;this.active=0;}
 async extract(request,{signal}={}){
  if(this.runner)return this.runner(request,{signal});
  const python=path.join(this.speech.environmentBase,'speech-env','Scripts','python.exe');if(!fs.existsSync(python))throw Error('请先在依赖中心准备本地语音识别环境（含视频解码器）');
  signal?.throwIfAborted();
  return new Promise((resolve,reject)=>{
   let out="",failure=null;const child=spawn(python,["-I","-X","utf8",path.join(this.speech.project,"scripts/chat-video-extract.py")],{detached:process.platform!=="win32",windowsHide:true,stdio:["pipe","pipe","ignore"]});
   const kill=reason=>{failure??=Error(reason);if(!child.pid)return;if(process.platform==="win32"){const stop=spawn("taskkill.exe",["/PID",String(child.pid),"/T","/F"],{windowsHide:true,stdio:"ignore"});stop.on("error",()=>child.kill());}else{try{process.kill(-child.pid,"SIGKILL");}catch{child.kill();}}};
   const abort=()=>kill("视频读取已取消"),timer=setTimeout(()=>kill("视频抽帧超时"),150000);signal?.addEventListener("abort",abort,{once:true});if(signal?.aborted)abort();
   child.stdout.on("data",b=>{out+=b;if(out.length>16*1024*1024)kill("视频帧输出超过上限");});child.stdin.on("error",()=>{});
   child.once("error",e=>{clearTimeout(timer);signal?.removeEventListener("abort",abort);reject(e);});
   child.once("close",()=>{clearTimeout(timer);signal?.removeEventListener("abort",abort);try{if(failure)throw failure;const result=JSON.parse(out);if(result.error)throw Error(result.error);resolve(result);}catch(e){reject(Error(e.message||"视频抽帧失败"));}});
   child.stdin.end(JSON.stringify(request));
  });
 }
 async incoming(segments,io,{signal,text='',audio=false,vision=true}={}){
  const videos=segments.filter(s=>s.type==='video');if(videos.length!==1)throw Error('每批最多理解一个视频，请分开发送');if(this.active>=2)throw Error('视频读取忙，请稍后再试');
  this.active++;let dir;
  try{signal?.throwIfAborted();const range=videoRange(text),bytes=await videoBytes(videos[0],io,{signal});if(!Buffer.isBuffer(bytes)||!bytes.length||bytes.length>MAX_VIDEO)throw Error('视频大小须为1B至50MB');
   const cache=path.join(this.speech.base,'chat-video-cache');fs.mkdirSync(cache,{recursive:true});dir=fs.mkdtempSync(path.join(cache,'job-'));const source=path.join(dir,'input.video');fs.writeFileSync(source,bytes,{mode:0o600});
   const result=await this.extract({source,output:dir,...range,audio},{signal});signal?.throwIfAborted();let transcript='';
   if(audio&&result.audio){try{transcript=String((await this.speech.enqueue(()=>this.speech.local(fs.readFileSync(result.audio),{signal}),{signal})).text??'').slice(0,3000);}catch{signal?.throwIfAborted();transcript='[音轨未能转写，不能据此推断对白]';}}
   const frames=result.frames.slice(0,6);if(!frames.length)throw Error('视频没有可读取的画面');
   return {images:vision?await videoSheets(frames):[],notice:`\n[聊天视频资料：总长${result.duration}秒；本次仅采样${result.start}—${result.end}秒，画面时间点${frames.map(f=>f.at).join('、')}秒。${vision?'画面按时间顺序附后，仅依据采样解释，不声称完整观看。':'当前模型不支持视觉，未提供画面，不得编造。'}${transcript?'音轨转写（仅本片段前60秒，资料）：'+transcript:'本次没有可用的音轨转写，不能推断对白或音乐。'}]`};
  }finally{this.active--;if(dir)fs.rmSync(dir,{recursive:true,force:true});}
 }
}
