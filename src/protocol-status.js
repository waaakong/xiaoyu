export class ProtocolStatus {
  constructor(now=Date.now){this.now=now;this.online=null;this.lastMessageAt=null;this.lastStatusAt=null;this.connectionAt=null;}
  connected(value){this.connectionAt=value?new Date(this.now()).toISOString():null;this.online=null;}
  observe(event,account){if(account&&String(event.self_id)!==String(account))return null;
    if(event.post_type==='message')this.lastMessageAt=new Date(this.now()).toISOString();
    let online=null;if(event.post_type==='meta_event'&&typeof event.status?.online==='boolean')online=event.status.online;
    if(event.post_type==='notice'&&event.notice_type==='bot_offline')online=false;
    if(event.post_type==='notice'&&event.notice_type==='bot_status'&&['online','offline'].includes(event.sub_type))online=event.sub_type==='online';
    if(online!==null){this.online=online;this.lastStatusAt=new Date(this.now()).toISOString();}return online;
  }
  verified(online=null){if(typeof online==='boolean'){this.online=online;this.lastStatusAt=new Date(this.now()).toISOString();}}
  state(){return {online:this.online,lastMessageAt:this.lastMessageAt,lastStatusAt:this.lastStatusAt,connectionAt:this.connectionAt};}
}
