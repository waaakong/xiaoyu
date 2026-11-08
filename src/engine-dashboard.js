// Only usage metadata crosses platform boundaries. Never return a scope, source,
// prompt, reply, or remembered fact from this account-wide dashboard.
export function engineDashboard(runtimes,{now=Date.now()}={}){
  const groups=new Map(),recent=[];let sampled=0,invalid=0;
  for(const [platform,runtime] of runtimes){
    if(!runtime?.store)continue;
    const rows=runtime.store.db.prepare('SELECT id,scope,created,data FROM usage ORDER BY id DESC LIMIT 1000').all();sampled+=rows.length;
    for(const row of rows){let d;try{d=JSON.parse(row.data);}catch{invalid++;continue;}if(!d||typeof d!=='object'){invalid++;continue;}
      const sourcePlatform=row.scope?.startsWith('local:')?'local':platform,engine=['codex','dsh'].includes(d.engine)?d.engine:'unknown',key=sourcePlatform+':'+engine;
      if(!groups.has(key))groups.set(key,{platform:sourcePlatform,engine,calls:0,failed:0,cancelled:0,knownUsage:0,inputTokens:0,cachedInputTokens:0,outputTokens:0,latencies:[]});
      const g=groups.get(key),u=d.last??d.total??d,status=d.status??d.outcome??'unknown';g.calls++;if(['failed','error'].includes(status))g.failed++;if(status==='cancelled')g.cancelled++;
      const number=n=>Number.isFinite(n)&&n>=0?n:null,input=number(u.inputTokens),output=number(u.outputTokens),cached=number(u.cachedInputTokens),ms=number(d.timing?.totalMs??d.totalMs);
      if(input!==null&&output!==null){g.knownUsage++;g.inputTokens+=input;g.outputTokens+=output;g.cachedInputTokens+=cached??0;}
      if(ms!==null)g.latencies.push(ms);
      const timing=Object.fromEntries(['generationMs','deliveryMs','preflightMs','receiptMs'].filter(k=>number(d.timing?.[k])!==null).map(k=>[k,d.timing[k]]));
      const errorCode=typeof d.errorCode==='string'&&/^[A-Z][A-Z0-9_]{1,79}$/.test(d.errorCode)?d.errorCode:null;
      recent.push({id:platform+':'+row.id,platform:sourcePlatform,engine,model:typeof d.model==='string'?d.model.slice(0,300):null,created:row.created,status,kind:typeof d.kind==='string'?d.kind.slice(0,40):'chat',inputTokens:input,outputTokens:output,totalMs:ms,timing,errorCode});
    }
  }
  return {at:now,limitPerPlatform:1000,sampled,invalid,groups:[...groups.values()].map(({latencies,...g})=>{latencies.sort((a,b)=>a-b);return {...g,missingUsage:g.calls-g.knownUsage,latencySamples:latencies.length,p50Ms:latencies.length?latencies[Math.ceil(latencies.length*.5)-1]:null,p95Ms:latencies.length?latencies[Math.ceil(latencies.length*.95)-1]:null};}),recent:recent.sort((a,b)=>b.created.localeCompare(a.created)||b.id.localeCompare(a.id)).slice(0,30)};
}
