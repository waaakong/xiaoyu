// Single-use empty threads only; keys bind exact scope and instructions.
export class PreparedThreads {
  constructor(create,dispose,{now=Date.now,ttlMs=60000,max=4}={}){Object.assign(this,{create,dispose,now,ttlMs,max});this.entries=new Map();this.closed=false;}
  discard(entry){clearTimeout(entry.timer);entry.promise.then(value=>{if(value)this.dispose(value).catch(()=>{});});}
  prime(key,params){if(this.closed||this.entries.has(key))return;while(this.entries.size>=this.max){const [old,e]=this.entries.entries().next().value;this.entries.delete(old);this.discard(e);}const entry={at:this.now()};entry.promise=Promise.resolve().then(()=>this.create(params)).catch(()=>null);entry.timer=setTimeout(()=>{if(this.entries.get(key)===entry){this.entries.delete(key);this.discard(entry);}},this.ttlMs);entry.timer.unref?.();this.entries.set(key,entry);}
  async take(key,params){const entry=this.entries.get(key);if(entry){this.entries.delete(key);clearTimeout(entry.timer);if(!this.closed&&this.now()-entry.at<this.ttlMs){const value=await entry.promise;if(value)return value;}else this.discard(entry);}return this.create(params);}
  close(){this.closed=true;for(const e of this.entries.values())this.discard(e);this.entries.clear();}
}
