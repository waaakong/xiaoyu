import {setTimeout as delay} from 'node:timers/promises';

export function rhythmWindow(policy={},event={}){if(policy.mergeQueued===false||/^\//u.test(event.text??'')||event.social?.kind==='poke')return event.social?.kind==='poke'?3000:0;return policy.rhythmMode==='social'?3000:policy.rhythmMode==='fast'?650:0;}
export async function waitForFragments(entry,signal){const ms=rhythmWindow(entry.r.policy,entry.r),remaining=Math.max(0,ms-(Date.now()-entry.receivedAt));if(remaining)await delay(remaining,null,{signal});return remaining;}
export function coldHistory(rows,text,now=Date.now()){
  if(!rows.length||/(?:上次|之前|还记得|以前|刚才|先前|继续|接着)/u.test(text))return {rows,cold:false};
  const last=rows.at(-1),at=Date.parse(String(last.created??'').replace(' ','T')+(/Z$|[+]\d\d:\d\d$/.test(last.created??'')?'':'Z'));
  return Number.isFinite(at)&&now-at>30*60000?{rows:rows.slice(-4),cold:true}:{rows,cold:false};
}
export function responseDecision(reply){const value=String(reply??'').trim();if(/^(?:\[?(?:SILENT|OBSERVE)\]?)$/iu.test(value))return {kind:value.toUpperCase().includes('SILENT')?'silent':'observe',text:''};return {kind:'respond',text:value.replace(/^RESPOND\s*[:：]\s*/u,'')};}
export class NaturalLimits {
  constructor(now=Date.now){this.now=now;this.scopes=new Map();}
  admit(r){if(!r.group||r.at||r.word||r.explicitFollowup)return true;const now=this.now(),rows=(this.scopes.get(r.scope)??[]).filter(t=>now-t<600000);this.scopes.set(r.scope,rows);if(rows.length>=10||rows.filter(t=>now-t<60000).length>=3||rows.length&&now-rows.at(-1)<15000)return false;rows.push(now);if(this.scopes.size>1000)for(const [scope,times]of this.scopes)if(!times.some(t=>now-t<600000))this.scopes.delete(scope);return true;}
}
