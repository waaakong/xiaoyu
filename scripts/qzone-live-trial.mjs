// Finite user-approved trial. A durable attempting marker precedes every external write.
import fs from 'node:fs';import {createHash} from 'node:crypto';
const approvedAccount=process.env.XIAOYU_TRIAL_QQ;
if(!/^\d+$/.test(approvedAccount??'')||!process.argv.includes('--execute')||process.argv[process.argv.indexOf('--account')+1]!==approvedAccount)throw Error('Requires XIAOYU_TRIAL_QQ and matching --execute --account');

const base=new URL('../data/qzone-notebook-acceptance/',import.meta.url),journal=new URL('live-trial.json',base),proposal=JSON.parse(fs.readFileSync(new URL('proposed-live-trial.json',base),'utf8'));
let preflightFailure=null,recoveredState=null,recoveredCount=0;
if(fs.existsSync(journal)){const old=JSON.parse(fs.readFileSync(journal,'utf8'));
 if(process.argv.includes('--resume-verified-text')&&old.operations.length===1&&old.operations[0].kind==='publish-0'&&old.operations[0].status==='accepted'&&old.posts.length===1&&old.posts[0].kind==='text'&&old.error?.includes('UnicodeEncodeError'))recoveredState=old;
 else if(process.argv.includes('--resume-verified-video')&&old.operations.length===3&&old.operations.every((o,i)=>o.kind==='publish-'+i&&o.status==='accepted')&&old.posts.length===3&&old.error==='Video/public visibility not verified; no retry'){const proof=JSON.parse(fs.readFileSync(new URL('video-resource-proof.json',base),'utf8'));const video=old.operations[2].result;if(!proof.ok||proof.fid!==video.fid||proof.data?.vid!==video.vid||!proof.data.sameVideo||!proof.data.publicVerified||![200,206].includes(proof.data.httpStatus)||!/^video\/|octet-stream/.test(proof.data.contentType??'')||Date.now()-Date.parse(proof.at)>600000)throw Error('Fresh exact video proof required');recoveredState=old;recoveredCount=3;}
 else if(process.argv.includes('--resume-preflight-only')&&!old.operations.length&&!old.posts.length&&old.error==='Concrete preview differs from approved draft')preflightFailure={at:old.at,error:old.error,externalSubmissions:0};
 else throw Error('Trial already started; inspect journal, never automatically replay.');
}
if(recoveredState&&!recoveredCount)recoveredCount=1;
const session=JSON.parse(fs.readFileSync(new URL('../data/qq-live-session.json',import.meta.url),'utf8'));
const headers={'X-Session-Token':session.token,Origin:session.origin,'Content-Type':'application/json'};
const request=async(route,body)=>{const r=await fetch(session.origin+'/api/'+route,{method:body===undefined?'GET':'POST',headers,...body===undefined?{}:{body:JSON.stringify(body)}});const result=await r.json();if(!r.ok)throw Error(result.error??('HTTP '+r.status));return result;};
const expected=['Ciallo～(∠・ω< )⌒★ 小鱼 QQ 空间文字联调测试。','Ciallo～(∠・ω< )⌒★ 小鱼 QQ 空间图片联调测试，仅展示小鱼标志。','Ciallo～(∠・ω< )⌒★ 小鱼 QQ 空间视频联调测试，2秒小鱼标志。'];
if(proposal.account!==approvedAccount||proposal.drafts.length!==3||proposal.drafts.some((d,i)=>d.params.text!==expected[i]))throw Error('Approved proposal identity/content mismatch');
const state=recoveredState??{at:new Date().toISOString(),authorization:'User explicitly approved three public drafts, finite own-post interactions and deletion of these three test posts; stop on unknown; no retry',account:proposal.account,proposalHash:createHash('sha256').update(JSON.stringify(proposal)).digest('hex'),operations:[],posts:[],completed:false};
if(preflightFailure)state.preflightFailure=preflightFailure;
const canonical=value=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b))):item);
const save=()=>fs.writeFileSync(journal,JSON.stringify(state,null,2),{mode:0o600});
const findId=result=>{if(!result||typeof result!=='object')return '';for(const key of ['tid','fid'])if(typeof result[key]==='string'&&/^[-\w]{5,160}$/.test(result[key]))return result[key];for(const key of ['data','result']){const id=findId(result[key]);if(id)return id;}return '';};
async function send(draft,kind){const preview=await request('qzone/preview',{id:draft.id});if(preview.account!==proposal.account||preview.operation!==draft.operation||canonical(preview.params)!==canonical(['publish','publishVideo'].includes(draft.operation)?{...draft.params,mediaIds:draft.params.mediaIds??[]}:draft.params))throw Error('Concrete preview differs from approved draft');const operation={kind,draftId:draft.id,at:Date.now(),status:'attempting'};state.operations.push(operation);save();try{const result=await request('qzone/confirm',{token:preview.token,confirm:true});if(result.status!=='accepted')throw Error('Not accepted');operation.status='accepted';operation.result=result.result;save();return result.result;}catch(e){operation.status='unknown-or-rejected';operation.error=String(e.message).slice(0,200);save();throw e;}}
async function action(operation,params){const draft=await request('qzone/draft',{operation,params});return send({...draft,operation,params},operation);}
const detail=fid=>request('qzone/read?operation=detail&target='+proposal.account+'&fid='+encodeURIComponent(fid));
try{
  const status=await request('qzone/read?operation=status');if(!status.bound||status.account!==proposal.account)throw Error('Own account is not verified');
  const current=await request('qzone');for(const [i,draft] of proposal.drafts.entries()){const actual=current.drafts.find(d=>d.id===draft.id);if(!actual||actual.account!==proposal.account||actual.status!==(recoveredState&&i<recoveredCount?'accepted':'draft')||actual.params.text!==draft.params.text)throw Error('Proposal draft changed or already used');}
  if(recoveredState){for(let i=0;i<recoveredCount;i++){const proof=await detail(state.posts[i].fid);if(proof.text!==expected[i]||i===1&&!proof.images?.length)throw Error('Recovered post proof mismatch; stop');state.posts[i].readbackVerified=true;}state.recoveries??=[];state.recoveries.push({at:new Date().toISOString(),oldError:state.error,readOnlyVerified:true,existingPostsNotResent:recoveredCount});delete state.stopped;delete state.error;}
  save();
  for(const [index,draft]of proposal.drafts.entries()){
    if(recoveredState&&index<recoveredCount)continue;
    const result=await send(draft,'publish-'+index);let fid=findId(result);
    if(!fid){const feed=await request('qzone/read?operation=feed');const matches=feed.posts.filter(p=>p.target===proposal.account&&p.text===draft.params.text);if(matches.length!==1)throw Error('Published ID not uniquely verified; stop, do not republish');fid=matches[0].fid;}
    if(state.posts.some(p=>p.fid===fid))throw Error('Duplicate returned post ID');
    state.posts.push({fid,kind:index===0?'text':index===1?'image':'video'});save();
    const readback=await detail(fid);if(!readback.text.includes(draft.params.text))throw Error('Published text readback mismatch');if(index===1&&!readback.images?.length)throw Error('Image not verified in post readback');if(index===2&&result.verified!==true)throw Error('Video/public visibility not verified; no retry');
    state.posts.at(-1).readbackVerified=true;save();console.log(JSON.stringify({kind:state.posts.at(-1).kind,posted:true,readbackVerified:true}));
  }
  const fid=state.posts[0].fid,target=proposal.account;
  await action('like',{target,fid});await action('unlike',{target,fid});
  await action('comment',{target,fid,text:'QQ空间评论联调测试'});
  const comments=(await detail(fid)).comments.filter(c=>c.uin===target&&c.text==='QQ空间评论联调测试');if(comments.length!==1||!comments[0].id)throw Error('New own comment not uniquely verified');
  await action('reply',{target,fid,commentId:comments[0].id,commentUin:target,text:'QQ空间回复联调测试'});
  const replies=(await detail(fid)).comments.filter(c=>c.uin===target&&c.text==='QQ空间回复联调测试');if(replies.length!==1)throw Error('New reply not uniquely verified');
  for(const post of state.posts){await action('delete',{target,fid:post.fid});post.deleteAccepted=true;save();}
  const remaining=(await request('qzone/read?operation=feed')).posts;if(state.posts.some(p=>remaining.some(r=>r.fid===p.fid)))throw Error('Cleanup readback still contains test post; do not retry deletion');
  state.completed=true;state.cleanupVerified=true;save();console.log(JSON.stringify({completed:true,deletedOnlyThesePosts:state.posts.map(p=>p.fid),cleanupVerified:true}));
}catch(e){state.stopped=true;state.error=String(e.message).slice(0,240);save();console.error(JSON.stringify({stopped:true,error:state.error,knownTestPosts:state.posts.map(p=>p.fid),noAutomaticRetry:true}));process.exitCode=1;}
