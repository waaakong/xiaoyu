import {validId} from './chat-identity.js';
import {forwardRecord,pokeEvent} from './social-events.js';
import {serverMessageId} from './wechat-receipts.js';

export function wechatEvent(payload,cutoff,{config,policy,onVoice=()=>{}}){
  const p=payload,c=config,fileType=6*2**32+49,quoteType=57*2**32+49,patType=62*2**32+49,forwardType=19*2**32+49;
  if(![1,3,34,47,fileType,quoteType,patType,forwardType].includes(p?.type)||p.event!=='message.new'||p.isSend||p.talkerId===c.account||
     !validId(String(p.sessionId??''),'wechat')||!validId(String(p.talkerId??''),'wechat')||
     !Number.isFinite(Number(p.timestamp))||Number(p.timestamp)<cutoff||!String(p.rawid??p.serverId??p.localId??p.messageId??''))return null;
  const group=p.sessionId.includes('@chatroom'),scope=`wechat:${c.account}:${group?'group':'private'}:${p.sessionId}`,permissions=policy(scope);
  if(!permissions.enabled||!group&&p.sessionId!==p.talkerId||group&&permissions.allowedSenders?.length&&!permissions.allowedSenders.includes(p.talkerId))return null;
  if(p.type===patType){if(p.pat?.actor!==p.talkerId||p.pat?.target!==c.account)return null;return pokeEvent({post_type:'notice',notice_type:'notify',sub_type:'poke',self_id:c.account,user_id:p.talkerId,target_id:p.pat.target,time:Number(p.timestamp),message_id:String(p.rawid),sender:{nickname:p.senderName??p.talkerId},...(group?{group_id:p.sessionId}:{})},'wechat');}
  const message=[];
  if(p.type===forwardType){if(!permissions.forwardRead||p.forwardedRecord?.version!==1)return null;message.push({type:'forward',data:{record:forwardRecord(p.forwardedRecord)}});}
  if(p.type===quoteType){const ref=p.quoteReply?.reference,id=serverMessageId(ref?.messageId);if(p.quoteReply?.version!==1||!id||group&&ref.conversationId!==p.sessionId)return null;message.push({type:'reply',data:{id}});}
  if(p.type===34){
    if(!permissions.speechInput||!/^[a-f0-9]{64}$/.test(p.voice?.id??'')||!Number.isSafeInteger(Number(p.conversationId))||Number(p.conversationId)<=0)return null;
    onVoice(p.voice.id,{account:c.account,scope,peer:p.sessionId,sender:p.talkerId,conversationKey:`wechat:${group?'group':'private'}:${p.conversationId}`});
    message.push({type:'record',data:{file:p.voice.id}});
  }else{
    if(p.type!==forwardType&&typeof p.content==='string'&&p.content.length<=4000)message.push({type:'text',data:{text:p.content}});
    if([3,47].includes(p.type)&&/^[a-f0-9]{64}$/.test(p.image?.id??p.imageId??''))message.push({type:'image',data:{file:p.image?.id??p.imageId}});
    if(p.type===fileType&&/^[a-f0-9]{64}$/.test(p.file?.id??''))message.push({type:'file',data:{file:p.file.id,name:String(p.file.name??'附件').slice(0,255),size:p.file.size??null}});
  }
  if(!message.length)return null;
  const mentions=p.mentions??p.atUserIds??[],named=p.type!==forwardType&&(c.mentionNames??[]).some(n=>String(p.content).includes('@'+n+'\u2005')||String(p.content).endsWith('@'+n));
  // Retain transport-provided mention identities, not just mentions of the bot.
  // Textual @names and forwarded inner records must not certify another account.
  const realMentions=group&&p.type!==forwardType&&Array.isArray(mentions)?[...new Set(mentions.filter(id=>typeof id==='string'&&validId(id,'wechat')&&id!=='all'&&!id.includes('@chatroom')))].slice(0,20):[];
  if(named||Array.isArray(mentions)&&mentions.includes(c.account))realMentions.unshift(c.account);
  for(const id of new Set(realMentions))message.unshift({type:'at',data:{qq:id}});
  return {wechatTiming:{readerObservedAgeMs:Math.max(0,Date.now()-Number(p.timestamp)*1000)},post_type:'message',message_type:group?'group':'private',self_id:c.account,user_id:p.talkerId,
    ...(group?{group_id:p.sessionId}:{}),wechatServerId:serverMessageId(p.serverId),message_id:String(p.rawid??p.serverId??p.localId??p.messageId??''),message,sender:{nickname:p.senderName??p.talkerId}};
}
