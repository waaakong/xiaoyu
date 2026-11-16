import {setTimeout as sleep} from 'node:timers/promises';

export function batchable(a,b){
 const x=a.r,y=b.r;
 return x.scope===y.scope&&x.user===y.user&&x.policy.personaId===y.policy.personaId&&x.policy.engine===y.policy.engine&&x.policy.model===y.policy.model&&a.quoteId===b.quoteId&&![x,y].some(r=>r.hasAudio||r.hasForward||r.social||/^\//u.test(r.text)||r.groupAddressing?.allow===false||r.event?.message?.some(s=>s.type==='at'&&String(s.data?.qq)!==r.account));
}
export function batchLimits(p={}){const social=p.rhythmMode==='social';return {text:p.aggregateTextMs??(social?2500:1600),media:p.aggregateMediaMs??(social?3500:2500),max:p.aggregateMaxMs??(social?10000:8000)};}
export function batchParts(entry,pending,{absorb=false}={}){
 const parts=[...(entry.carry??[]),entry];if(entry.r.policy.mergeQueued===false||entry.r.policy.rhythmMode==='instant')return parts;
 for(const next of pending){if(next===entry||next.absorbed)continue;if(!batchable(entry,next))break;
  const added=[...(next.carry??[]),next].filter(x=>!parts.includes(x)),all=[...parts,...added];
  const images=all.reduce((n,x)=>n+((x.raw?.event??x.r.event)?.message??[]).filter(s=>['image','mface'].includes(s.type)).length,0);
  if(all.length>8||images>2||all.reduce((n,x)=>n+(x.raw?.text??x.r.text).length,0)>4000||next.receivedAt-parts[0].receivedAt>batchLimits(entry.r.policy).max)break;
  if(absorb)next.absorbed=true;parts.push(...added);
 }return [...new Set(parts)];
}
export async function waitBatch(entry,pending,signal,{now=Date.now,wait=sleep}={}){
 const p=entry.r.policy;if(p.mergeQueued===false||p.rhythmMode==='instant'||/^\//u.test(entry.r.text))return 0;
 const started=now(),limits=batchLimits(p);
 while(true){signal?.throwIfAborted();const parts=batchParts(entry,pending()),last=Math.max(...parts.map(x=>x.receivedAt)),first=Math.min(...parts.map(x=>x.receivedAt)),hasImage=parts.some(x=>x.r.hasImages),end=Math.min(first+limits.max,last+(hasImage?limits.media:limits.text)),left=end-now();if(left<=0)break;await wait(Math.min(left,50),null,{signal});}
 return now()-started;
}
export function applyBatch(entry,parts){
 const r=entry.r;r.text=parts.map(x=>x.raw?.text??x.r.text).join('\n');r.event={...r.event,message:parts.flatMap(x=>(x.raw?.event??x.r.event).message)};r.hasImages=parts.some(x=>x.r.hasImages);r.turnParts=parts.map(x=>({id:x.rowId,text:x.raw?.text??x.r.text}));r.mediaSourceIds=parts.flatMap(x=>(x.raw?.event??x.r.event).message.filter(s=>['image','mface'].includes(s.type)).map(()=>x.rowId));return r;
}
export function naturalGate(policy,receivedAt,signal,{now=Date.now,random=Math.random,wait=sleep,assertFresh=()=>{},state=()=>null,mode=()=> 'casual',timing={}}={}){
 const enabled=()=>policy.naturalDelay!==false&&policy.rhythmMode!=='instant'&&mode()!=='task';let packets=0,firstDone=false;
 const pause=async ms=>{signal?.throwIfAborted();assertFresh();if(ms>0)await wait(ms,null,{signal});signal?.throwIfAborted();assertFresh();};
 const pace=()=>{const s=typeof state==='function'?state():state;if(!s?.enabled||s.expressionStyle==='off')return 1;return s.axes?.energy<.3?1.25:s.valence>.3?.9:1;};
 return {async first(){if(firstDone)return;firstDone=true;const min=policy.replyDelayMinMs??1000,max=Math.max(min,policy.replyDelayMaxMs??8000),base=policy.mergeQueued===false?0:batchLimits(policy).text,target=enabled()?base+Math.round((min+random()*(max-min))*pace()):0;timing.replyDelayTargetMs=target;timing.replyPace=pace();const remaining=Math.max(0,target-(now()-receivedAt));timing.replyDelayMs=remaining;await pause(remaining);},async packet(){await this.first();if(packets++&&enabled())await pause(Math.round((300+random()*600)*pace()));}};
}
