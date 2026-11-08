import http from 'node:http';
import {chatParts} from './chat-rhythm.js';
import crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {EventEmitter} from 'node:events';
import {WebSocketServer,WebSocket} from 'ws';
import {forwardRecord} from './social-events.js';
export class OneBot extends EventEmitter {
  constructor(config){super();this.config=config;this.pending=new Map();this.socket=null;}
  async start(){
    this.http=http.createServer((_req,res)=>{res.writeHead(404);res.end();});
    this.wss=new WebSocketServer({noServer:true,maxPayload:15*1024*1024});
    this.http.on('upgrade',(req,socket,head)=>{
      const supplied=Buffer.from(req.headers.authorization?.replace(/^Bearer /i,'')??'');const expected=Buffer.from(this.config.onebotToken);
      if(req.url!='/onebot'||this.socket||supplied.length!==expected.length||!crypto.timingSafeEqual(supplied,expected)) {socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');return;}
      this.wss.handleUpgrade(req,socket,head,ws=>{
        this.socket=ws;this.emit('connection',true);ws.alive=true;
        ws.on('pong',()=>{ws.alive=true;});
        ws.on('message',raw=>{let msg;try{msg=JSON.parse(raw);}catch{return;}
          if(msg.echo!=null){const p=this.pending.get(String(msg.echo));if(!p)return;clearTimeout(p.timer);this.pending.delete(String(msg.echo));
            if(msg.status==='ok'&&Number(msg.retcode)===0)p.resolve(msg.data);else p.reject(new Error('OneBot 拒绝发送'));return;}
          this.emit('message',msg);
        });
        ws.on('error',()=>{});
        ws.on('close',()=>{if(this.socket!==ws)return;this.socket=null;for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(new Error('OneBot 连接断开，投递结果未知'));}this.pending.clear();this.emit('connection',false);});
      });
    });
    await new Promise((resolve,reject)=>{this.http.once('error',reject);this.http.listen(this.config.port,'127.0.0.1',resolve);});
    this.heartbeat=setInterval(()=>{const s=this.socket;if(!s)return;if(!s.alive){s.terminate();return;}s.alive=false;s.ping();},30000);
  }
  get connected(){return this.socket?.readyState===WebSocket.OPEN;}
  action(action,params){
    if(!this.connected)return Promise.reject(new Error('QQ 尚未连接'));
    const echo=crypto.randomUUID();
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.pending.delete(echo);reject(new Error('OneBot 回执超时，投递结果未知'));},10000);
      this.pending.set(echo,{resolve,reject,timer});
      this.socket.send(JSON.stringify({action,params,echo}),err=>{if(err){clearTimeout(timer);this.pending.delete(echo);reject(new Error('OneBot 发送失败'));}});
    });
  }
  async prepareMention(event,{mention,beforeMention,beforeSend}={}){
    if(event.message_type!=='group'||!mention||!/^\d+$/.test(String(mention.id))||String(mention.id)===String(event.self_id))return null;
    let member;try{member=await this.action('get_group_member_info',{group_id:event.group_id,user_id:Number(mention.id),no_cache:true});}catch{return null;}
    beforeSend?.();if(String(member?.user_id)!==String(mention.id)||member.group_id!=null&&String(member.group_id)!==String(event.group_id))return null;
    if(beforeMention&&!beforeMention())return null;return String(mention.id);
  }
  async reply(event,text,{beforeSend,natural=false,maxParts=3,mention,beforeMention,quote}={}){
    const receipts=[];
    const mentionId=await this.prepareMention(event,{mention,beforeMention,beforeSend});
    for(const part of natural?chatParts(text,{maxParts}):[text]){
    const chars=Array.from(part);for(let i=0;i<chars.length;i+=900){
      beforeSend?.();const message=[{type:'text',data:{text:chars.slice(i,i+900).join('')}}];
      if(!receipts.length&&quote){if(!/^-?\d{1,24}$/.test(String(quote.id)))throw Error('引用消息编号无效');message.unshift({type:'reply',data:{id:String(quote.id)}});}
      if(event.message_type==='group'){
        if(receipts.length===0&&mentionId)message.unshift({type:'at',data:{qq:mentionId}},{type:'text',data:{text:' '}});
        const receipt=await this.action('send_group_msg',{group_id:event.group_id,message});receipts.push({...receipt,...(!receipts.length&&mentionId?{mentionId}:{})});
      }else receipts.push(await this.action('send_private_msg',{user_id:event.user_id,message}));
    }
    }return receipts;
  }
  async image(event,bytes){const message=[{type:'image',data:{file:'base64://'+bytes.toString('base64')}}];return this.action(event.message_type==='group'?'send_group_msg':'send_private_msg',event.message_type==='group'?{group_id:event.group_id,message}:{user_id:event.user_id,message});}
  async forwardRecord(id){if(!/^[\w-]{1,256}$/.test(String(id)))throw Error('转发记录编号无效');const data=await this.action('get_forward_msg',{message_id:String(id)});return forwardRecord({messages:data?.messages??data?.message??[]});}
  async socialCapabilities(){
    if(!this.connected)return {quote:false,poke:false,forward:false};
    if(this.socialSocket===this.socket&&this.socialCheckedAt>Date.now()-60000)return this.socialCap;
    const save=cap=>{this.socialSocket=this.socket;this.socialCheckedAt=Date.now();this.socialCap=cap;return cap;};
    // Read-only discovery, never probe a send action with a real target.
    try{const info=await this.action('get_version_info',{});if(String(info?.app_name).toLowerCase()==='snowluma'&&/^v?2\.3\.4(?:-node)?$/.test(String(info.app_version))){this.socialActions=new Set(['friend_poke','group_poke','send_poke','send_group_forward_msg','send_private_forward_msg']);return save({quote:true,poke:true,forward:true,source:'SnowLuma 2.3.4 已核对动作定义；客户端收发仍需实测'});}}catch{}
    try{const data=await this.action('get_supported_actions',{}),actions=data?.actions??data?.supported_actions??data;if(Array.isArray(actions)){this.socialActions=new Set(actions.map(a=>typeof a==='string'?a:a.name));return save({quote:true,poke:['send_poke','group_poke','friend_poke'].some(a=>this.socialActions.has(a)),forward:this.socialActions.has('send_group_forward_msg')&&this.socialActions.has('send_private_forward_msg')});}}catch{}
    return save({quote:true,poke:false,forward:false,reason:'协议端未提供可核验的扩展动作清单'});
  }
  async poke(event,target,{beforeSend}={}){
    const cap=await this.socialCapabilities();if(!cap.poke)throw Error('当前协议未核验拍一拍动作');
    if(!/^\d+$/.test(String(target))||String(target)===String(event.self_id))throw Error('拍一拍目标无效');
    const group=event.message_type==='group';if(group){const member=await this.action('get_group_member_info',{group_id:event.group_id,user_id:Number(target),no_cache:true});if(String(member?.user_id)!==String(target))throw Error('拍一拍目标不在当前群');}else if(String(target)!==String(event.user_id))throw Error('不允许跨聊天拍一拍');
    const action=this.socialActions.has('send_poke')?'send_poke':group?'group_poke':'friend_poke';if(!this.socialActions.has(action))throw Error('当前聊天不支持拍一拍');
    beforeSend?.();return this.action(action,{user_id:Number(target),...(group?{group_id:event.group_id}:{})});
  }
  async forward(event,rows,{beforeSend}={}){
    if(!Array.isArray(rows)||!rows.length||rows.length>50||rows.some(r=>!r.source||!/^[-\d]{1,24}$/.test(String(r.source))))throw Error('必须选择当前聊天的真实消息');
    const group=event.message_type==='group';beforeSend?.();return this.action(group?'send_group_forward_msg':'send_private_forward_msg',{...(group?{group_id:event.group_id}:{user_id:event.user_id}),messages:rows.map(r=>({type:'node',data:{id:String(r.source)}}))});
  }
  async record(event,file,{beforeSend=()=>{}}={}){const message=[{type:'record',data:{file:pathToFileURL(file).href}}];beforeSend();return this.action(event.message_type==='group'?'send_group_msg':'send_private_msg',event.message_type==='group'?{group_id:event.group_id,message}:{user_id:event.user_id,message});}
  async stop(){clearInterval(this.heartbeat);this.socket?.terminate();if(this.wss)await new Promise(r=>this.wss.close(r));if(this.http)await new Promise(r=>this.http.close(r));}
}
