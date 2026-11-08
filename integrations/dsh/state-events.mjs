import {createHash} from 'node:crypto';
// Metadata-only lifecycle observation: no titles, prompts, replies or paths.
export function runtimeEvents(ctx,instanceId){
  const events=[],seen=new Set(),pending=new Map(),reasons=new Map();let supported=false,sequence=0;
  const diagnostics={sessionCallbacks:0,turnEnds:0,statusCallbacks:0,ignoredSubagents:0,unknownReasons:0};
  const child=s=>s?.header?.origin==='subagent'||s?.header?.delegationDepth>0;
  const add=(kind,key,reason)=>{const id=createHash('sha256').update(instanceId+':'+key).digest('hex');if(seen.has(id))return;seen.add(id);events.push({id,kind,service:'dsh',at:Date.now(),...(reason?{reason}:{})});if(events.length>100)seen.delete(events.shift().id);};
  if(typeof ctx.on==='function'){
    supported=true;
    ctx.on('session/event',(session,event)=>{
      diagnostics.sessionCallbacks++;if(child(session)){diagnostics.ignoredSubagents++;return;}if(typeof session?.id!=='string'||event?.type!=='turn/end')return;
      diagnostics.turnEnds++;const data=event.data??{},kind={completed:'completed',error:'failed',aborted:'cancelled',blocked:'waiting','max-tokens':'waiting'}[typeof data.reason==='string'?data.reason:data.reason?.kind];
      if(!kind){diagnostics.unknownReasons++;return;}clearTimeout(pending.get(session.id));pending.delete(session.id);reasons.set(session.id,Date.now());if(reasons.size>200)reasons.delete(reasons.keys().next().value);add(kind,session.id+':'+String(data.turn??event.seq??'unknown')+':'+kind);
    },{global:true});
    ctx.on('agent/status',({agent,status}={})=>{
      diagnostics.statusCallbacks++;const session=agent?.session;if(child(session)){diagnostics.ignoredSubagents++;return;}if(typeof session?.id!=='string')return;
      if(status==='busy'||status==='running'){add('started',session.id+':busy:'+ ++sequence);return;}
      if(status!=='idle'||Date.now()-(reasons.get(session.id)??0)<2000)return;
      clearTimeout(pending.get(session.id));const timer=setTimeout(()=>{pending.delete(session.id);add('waiting',session.id+':idle:'+ ++sequence,'idle-without-reason');},1000);timer.unref?.();pending.set(session.id,timer);
    },{global:true});
    for(const type of ['approval/request','user-questions/request'])ctx.on(type,(request,next)=>{if(!child(request?.agent?.session)){const id=request?.id??request?.requestId;if(typeof id==='string')add('waiting',type+':'+id);}return typeof next==='function'?next():undefined;},{global:true});
    ctx.on('dispose',()=>{for(const timer of pending.values())clearTimeout(timer);pending.clear();});
  }
  return {read:()=>{let roots=null;try{const registry=ctx.get?.('agents');if(typeof registry?.roots==='function')roots=registry.roots().length;}catch{}return {supported,events:events.map(e=>({...e})),diagnostics:{...diagnostics,liveRoots:roots}};}};
}
