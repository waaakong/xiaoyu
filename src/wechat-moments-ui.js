import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {root} from './config.js';
import {WeChatIO} from './wechat-io.js';
import {assertClient,inspectWeChat} from './wechat-client.js';

const IMAGE=/[.](?:png|jpe?g|bmp)$/i, VIDEO=/[.](?:mp4|mov|mkv|mgp|mpe?g|avi|wmv|rm|rmvb)$/i;
const MIME={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.bmp':'image/bmp','.mp4':'video/mp4','.mov':'video/quicktime','.mkv':'video/x-matroska','.mgp':'video/mpeg','.mpeg':'video/mpeg','.mpg':'video/mpeg','.avi':'video/x-msvideo','.wmv':'video/x-ms-wmv','.rm':'application/vnd.rn-realmedia','.rmvb':'application/vnd.rn-realmedia-vbr'};
const PREVIEW_LIMIT=6*1024*1024;
const exec=promisify(execFile);

export function readMomentMedia(file){
  const value=typeof file==='string'?file.trim():'';
  if(!value||!path.isAbsolute(value))throw Error('媒体文件必须使用绝对路径');
  if(!IMAGE.test(value)&&!VIDEO.test(value))throw Error('仅支持图片或视频文件');
  let st;try{st=fs.statSync(value);}catch{throw Error('媒体文件不存在：'+path.basename(value));}
  if(!st.isFile()||st.size<=0)throw Error('媒体文件不可用：'+path.basename(value));
  const kind=IMAGE.test(value)?'image':'video',mime=MIME[path.extname(value).toLowerCase()]??(kind==='image'?'application/octet-stream':'video/mp4');
  const preview=kind==='image'&&st.size<=PREVIEW_LIMIT;
  return {name:path.basename(value),path:value,kind,size:st.size,mime,preview,base64:preview?fs.readFileSync(value).toString('base64'):undefined};
}

export function validateMomentUiRequest(body={}){
  const text=typeof body.text==='string'?body.text.trim():'';
  if(text.length>1500)throw Error('朋友圈正文最多 1500 字');
  const media=Array.isArray(body.media)?body.media:typeof body.media==='string'?body.media.split(/\r?\n/):[];
  const paths=media.map(s=>String(s).trim()).filter(Boolean);
  if(paths.length>9)throw Error('一次最多 9 张图片，或 1 个视频');
  let images=0,videos=0;
  for(const file of paths){
    if(!path.isAbsolute(file))throw Error('媒体文件必须使用绝对路径');
    if(!IMAGE.test(file)&&!VIDEO.test(file))throw Error('仅支持图片或视频文件');
    let st;try{st=fs.statSync(file);}catch{throw Error('媒体文件不存在：'+path.basename(file));}
    if(!st.isFile()||st.size<=0)throw Error('媒体文件不可用：'+path.basename(file));
    if(IMAGE.test(file))images++;else videos++;
  }
  if(videos>1)throw Error('一次最多 1 个视频');
  if(videos&&images)throw Error('图片和视频不能在同一条朋友圈中混发');
  if(!text&&!paths.length)throw Error('请填写正文或选择图片/视频');
  const privacy=body.privacy==='private'?'private':'public';
  return {text,media:paths,privacy,publish:body.publish===true};
}

async function runMomentUi(manager,req){
  if(manager?.config?.foregroundCompatibility!==true)throw Error('请先在微信接入中开启控件适配');
  if(!req||typeof req!=='object')throw Error('朋友圈界面请求无效');
  await manager.backend.startReader();
  const client=assertClient(await inspectWeChat(manager.config.executable));
  const io=new WeChatIO({config:()=>manager.config,root,dir:manager.dataDir});
  const reader=await io.reader('/api/v1/reader/status');
  if(reader.backend!=='weflow-cli-nt'||reader.lastError)throw Error('微信读取服务未就绪');
  const identity=await manager.backend.verifyIdentity({client,reader});
  if(identity?.version!==client.version||!Number.isInteger(identity?.clientPid))throw Error('微信实时账号证据无效');
  const dir=path.join(manager.dataDir,'wechat-moments-ui');fs.mkdirSync(dir,{recursive:true});
  const id=crypto.randomUUID(),requestFile=path.join(dir,id+'-request.json'),outFile=path.join(dir,id+'-result.json');
  fs.writeFileSync(requestFile,JSON.stringify(req,null,2),{mode:0o600});
  const run=async({signal})=>{
    fs.writeFileSync(outFile,JSON.stringify({ok:false,stage:'starting',submissionAttempted:false}));
    try{await exec('powershell.exe',['-NoProfile','-STA','-ExecutionPolicy','Bypass','-File',path.join(root,'integrations','wechat','moments-ui.ps1'),'-Pid',String(identity.clientPid),'-Request',requestFile,'-Out',outFile],{timeout:19000,signal,windowsHide:true,encoding:'utf8',maxBuffer:32000});}catch(e){let state={};try{state=JSON.parse(fs.readFileSync(outFile,'utf8').replace(/^\uFEFF/,''));}catch{}const err=Error('朋友圈操作中止：'+(state.error??state.stage??e.code??'unknown'));err.submissionAttempted=state.submissionAttempted!==false;err.stage=state.stage;err.retryable=false;throw err;}
    const result=JSON.parse(fs.readFileSync(outFile,'utf8').replace(/^\uFEFF/,''));
    if(!result.ok){const error=Error('朋友圈界面操作失败：'+(result.error??result.stage??'unknown'));error.submissionAttempted=result.submissionAttempted!==false;error.stage=result.stage;error.retryable=['menu-not-found:选照片或视频','toolbar-publish-missing','discover-missing'].includes(result.error);throw error;}
    return {...result,requestId:id};
  };
  return manager.accessibility.run({client,identity},run);
}

export async function withMomentTrafficPaused(manager,task){
  if(typeof task!=='function')throw Error('朋友圈发布任务无效');
  const child=manager?.child;
  const wasRunning=!!child?.running;
  if(wasRunning)await child.stop();
  let result,error,resumeError;
  try{result=await task();}catch(e){error=e;}
  if(wasRunning&&!child.running){
    try{await child.start();}catch(e){resumeError=e;}
  }
  if(error){
    if(!resumeError)throw error;
    throw Error(String(error.message??error)+'；微信收发恢复失败：'+String(resumeError.message??resumeError));
  }
  if(resumeError)throw Error('朋友圈已发布，但微信收发恢复失败：'+String(resumeError.message??resumeError));
  return result;
}

export async function publishMomentUi(manager,body){
  const req=validateMomentUiRequest(body);if(!req.publish)return runMomentUi(manager,req);
  const account=manager.config.account,prepared=await runMomentUi(manager,{...req,phase:'prepare'});
  if(!prepared.prepared||!prepared.composeSignature){const e=Error('朋友圈内容尚未确认就绪，未提交');e.submissionAttempted=false;throw e;}
  if(manager.config.account!==account){const e=Error('微信账号改变，未提交');e.submissionAttempted=false;throw e;}
  return runMomentUi(manager,{...req,phase:'commit',composeSignature:prepared.composeSignature});
}

export async function inspectMomentsUi(manager,options={}){
  const inspect=['detail','album','tree','texts','query'].includes(options.inspect)?options.inspect:true;
  return runMomentUi(manager,{...options,inspect,text:'',media:[],privacy:'public',publish:false});
}

export async function inspectMomentsAlbum(manager){
  return runMomentUi(manager,{inspect:'album',text:'',media:[],privacy:'public',publish:false});
}

const cleanText=value=>String(value??'').replace(/\s+/g,' ').trim();
const MOMENT_META=/^(赞|点赞|评论|回复|展开|收起|全文|删除|投诉|收藏)$/u;
const MOMENT_TIME=/^(?:\d+\s*(?:秒|分钟|小时|天)前|刚刚|今天|昨天|前天|\d{1,2}[-/]\d{1,2}(?:\s+\d{1,2}:\d{2})?|\d{4}[-/]\d{1,2}[-/]\d{1,2})$/u;
const sha256=value=>crypto.createHash('sha256').update(String(value)).digest('hex');

/* 朋友圈列表的 UIA 文本没有结构，只能按“最长的一段是正文、其余像 作者：评论 的是评论”来还原。 */
export function parseMomentComments(items=[],{selfName=''}={}){
  const posts=[];
  const owner=cleanText(selfName);
  for(const item of Array.isArray(items)?items:[]){
    const texts=(Array.isArray(item?.texts)?item.texts:[]).map(cleanText).filter(t=>t&&!MOMENT_META.test(t)&&!MOMENT_TIME.test(t));
    if(!texts.length)continue;
    const linked=texts.filter(t=>/^(.{1,24}?)[：:]\s*(.+)$/u.test(t)),plain=texts.filter(t=>!linked.includes(t));
    const rawPost=plain.slice().sort((a,b)=>b.length-a.length)[0]??cleanText(item?.name)??linked[0];
    let postText=cleanText(rawPost).replace(/\s*包含\d+张图片\s*/u,' ').replace(/\s*\d+\s*(?:秒|分钟|小时|天)前\s*$/u,'').trim();
    if(owner&&postText.startsWith(owner+' '))postText=postText.slice(owner.length).trim();
    const comments=[];
    for(const value of texts){
      if(value===postText)continue;
      const match=value.match(/^(.{1,24}?)[：:]\s*(.+)$/u);
      if(!match)continue;
      const author=cleanText(match[1]),content=cleanText(match[2]);
      if(!author||!content||content.length<1)continue;
      const self=!!owner&&author===owner;
      comments.push({identityVerified:false,remoteId:sha256([postText,author,content].join('\u0000')),author,content,createdAt:0,self,direction:self?'self':'in'});
    }
    posts.push({text:postText,identityVerified:false,media:[],privacy:'private',publishedAt:0,comments});
  }
  return posts;
}

export async function readMomentComments(manager,{selfName=''}={}){
  const owner=String(selfName??'').slice(0,60);
  const result=await runMomentUi(manager,{action:'comments',selfName:owner,text:'',media:[],privacy:'public',publish:false});
  return {...result,posts:parseMomentComments(result.items,{selfName:owner})};
}

export async function replyMomentComment(manager,payload={}){
  if(payload.dryRun!==true)throw Error('界面评论发送尚无精确身份与回执校验，已停用；请使用已核验的原生通道');
  const text=String(payload.text??'').trim();
  if(!text)throw Error('回复内容不能为空');
  if(text.length>80)throw Error('回复最多 80 字');
  return runMomentUi(manager,{action:'reply',text,media:[],privacy:'public',publish:false,dryRun:payload.dryRun===true,selfName:String(payload.selfName??''),comment:{postId:String(payload.postId??''),postText:String(payload.postText??''),commentId:String(payload.commentId??''),author:String(payload.author??''),content:String(payload.content??''),remoteKey:String(payload.remoteKey??'')}});
}
