import {groupReplyGate} from './group-reply.js';
import {validId} from './chat-identity.js';
import {policyFor} from './config.js';
export function normalize(event,config){
  if(event.post_type!=='message'||!['private','group'].includes(event.message_type)||String(event.user_id)===String(event.self_id)||!Array.isArray(event.message)||!validId(String(event.self_id),config.platform??'qq')||!validId(String(event.user_id),config.platform??'qq'))return null;
  const account=String(event.self_id),user=String(event.user_id),group=event.message_type==='group'?String(event.group_id):null;
  if(group&&!validId(group,config.platform??'qq'))return null;
  const scope=`${config.platform??'qq'}:${account}:${group?'group':'private'}:${group??user}`,memberScope=group?`${scope}:member:${user}`:scope;
  const policy=policyFor(config,scope);if(!policy.enabled)return null;
  if(group&&policy.allowedSenders?.length&&!policy.allowedSenders.includes(user))return null;
  const text=event.message.filter(m=>m.type==='text').map(m=>String(m.data?.text??'')).join('').trim();
  if(text.length>4000)return null;
  const at=event.message.some(m=>m.type==='at'&&String(m.data?.qq)===account);
  const word=[...policy.wakeWords].sort((a,b)=>b.length-a.length).find(w=>policy.keywordMatch==='contains'?text.includes(w):text.startsWith(w));
  const clean=word&&text.startsWith(word)?text.slice(word.length).replace(/^[\s,，:：、]+/u,''):text;
  const hasForward=event.message.some(m=>m.type==='forward');
  const social=event.socialEvent??null;if(social?.kind==='poke'&&!policy.pokeResponse)return null;
  const hasImages=event.message.some(m=>['image','mface'].includes(m.type));
  const hasAudio=event.message.some(m=>m.type==='record');
  const face=event.message.filter(m=>m.type==='face').map(m=>`[QQ表情${String(m.data?.id).slice(0,6)}]`).join('');
  if(!clean&&!hasImages&&!face&&!hasAudio&&!hasForward)return null;
  return {scope,memberScope,user,account,group,policy,event,at,word,hasImages,hasAudio,hasForward,social,text:clean||face||(hasForward?'[用户发送了合并转发记录]':hasAudio?'[用户发送了语音]':'[用户发送了图片]'),speaker:JSON.stringify({id:user,name:String(event.sender?.card||event.sender?.nickname||user).slice(0,60)})};
}
export function isAwake(r,followups,now=Date.now(),quoteSelf=false,naturalAt=new Map(),random=Math.random){
  if(!groupReplyGate(r,{quoteSelf,quoteOther:r.quoteOther}).allow)return false;
  if(r.social?.kind==='poke')return true;
  if(!r.group||r.at||r.word||quoteSelf||(followups.get(r.memberScope)??0)>now)return true;
  if(r.policy.wakeMode!=='hybrid'||r.hasImages||r.hasAudio||r.hasForward||/^\//.test(r.text)||r.text.length<4)return false;
  if(now-(naturalAt.get(r.scope)??0)<r.policy.naturalCooldownSeconds*1000)return false;
  return random()<r.policy.naturalProbability;
}
export function route(event,config,followups,now=Date.now()){const r=normalize(event,config);return r&&isAwake(r,followups,now)?r:null;}
