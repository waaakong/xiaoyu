import {responseDecision} from './social-rhythm.js';
import {PluginGateway} from './plugin-gateway.js';
import {chatParts} from './chat-rhythm.js';
import {randomUUID} from 'node:crypto';

// Separate transport/platform: raw WeChat IDs never become synthetic QQ IDs.
export class WeChatPluginGateway extends PluginGateway {
  constructor(options){super({...options,url:'ws://127.0.0.1:6200/ws'});}
  async handle(r){const trace=randomUUID(),handled=await super.handle({...r,event:{...r.event,xiaoyu_lease_id:trace}});if(handled)this.leases.get(r.scope).outboundTrace=trace;return handled;}
  lease(kind,peer){
    const account=String(this.getAccount()??''),scope=`wechat:${account}:${kind}:${peer}`,l=this.leases.get(scope),p=this.policy(scope);
    if(!['private','group'].includes(kind)||!l||l.until<=this.now()||String(l.account)!==account||!p.enabled||!p.pluginsEnabled||!(l.mode==='enhanced'?p.pluginMode==='enhanced':p.pluginCommands?.includes(l.command))||!this.onebot.connected)throw Error('微信插件请求已失效或未授权');
    l.signal?.throwIfAborted();l.assertFresh?.();return l;
  }
  async action(action,p={}){
    if(action!=='send'||!['private','group'].includes(p.kind)||typeof p.peer!=='string')throw Error('微信插件动作未开放');
    const l=this.lease(p.kind,p.peer);if(!p.trace||p.trace!==(l.trace??l.outboundTrace)||l.sendBusy||l.sends+(l.bufferedPackets??0)>=3||l.replyModelFailed)throw Error('微信插件请求不匹配、发送超限或模型失败');l.sendBusy=true;
    try{
      const message=await this.message(p.message,l),event={message_type:p.kind,user_id:l.user,...(p.kind==='group'?{group_id:l.peer}:{user_id:l.peer})};
      const guard=()=>{if(this.lease(p.kind,p.peer)!==l||l.sends>=3)throw Error('微信插件租约变化或发送超限');};let first;
      const text=message.filter(s=>s.type==='text').map(s=>s.data.text).join(''),images=message.filter(s=>s.type==='image'),parts=l.mode==='enhanced'&&!images.length?chatParts(text,{maxParts:this.policy(l.scope).maxBubbles??2}):[text];if(l.mode==='enhanced'&&!images.length&&responseDecision(text).kind!=='respond')return {suppressed:true,reason:'model-silence'};
      if(l.mode==='enhanced'&&l.bufferReply){if(this.policy(l.scope).voiceMode!==l.voiceMode)throw Error('只语音模式已改变');this.lease(p.kind,p.peer);l.bufferedPackets=(l.bufferedPackets??0)+1;l.bufferReply(message);return {buffered:true,delivered:false};}
      const packets=parts.length<=3-l.sends?parts:[text];
      for(const body of packets.filter(Boolean)){guard();l.sends++;const directed=l.prepareSend?.(body),sentText=directed?.text??body,receipts=await this.onebot.reply(event,sentText,{quote:directed?.quote,mention:directed?.target,beforeMention:directed?.beforeMention,beforeSend:()=>{this.lease(p.kind,p.peer);directed?.assertQuote?.();}}),receipt=receipts[0];if(receipt?.mentionId)directed?.confirmed();first??=receipt;await (l.onSent??this.onSent)({scope:l.scope,message:[{type:'text',data:{text:sentText}}],receipt,signal:l.signal,speechText:text});}
      for(const image of images){guard();l.sends++;const receipt=await this.onebot.image(event,Buffer.from(image.data.file.slice(9),'base64'),{beforeSend:()=>{this.lease(p.kind,p.peer);}});first??=receipt;await (l.onSent??this.onSent)({scope:l.scope,message:[image],receipt,signal:l.signal});}
      if(!first)throw Error('微信插件消息为空');this.lastResult={time:new Date(this.now()).toISOString(),scope:l.scope,status:'confirmed'};return first;
    }finally{l.sendBusy=false;}
  }
}
