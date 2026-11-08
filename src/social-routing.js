import {createHash} from 'node:crypto';
const stamp=row=>createHash('sha256').update(JSON.stringify([row.scope,row.id,row.source,row.text])).digest('hex');
export function quoteCandidates(store,r,history,rowId,{supported=false,policy=()=>r.policy}={}){
  if(!supported||!r.policy.quoteReplies||!r.group)return [];
  const ctx=store.shared.context(r.scope,r.user,policy),ids=[rowId,...history.map(x=>x.id).reverse()].slice(0,8),out=[];
  for(const id of ids){const row=store.db.prepare('SELECT * FROM messages WHERE id=?').get(id);if(!row||row.scope!==r.scope||!row.source||!['received','observed','delivered'].includes(row.status)||store.living.blocked(id)||!store.shared.messageAllowed(id,ctx))continue;
    const source=r.scope.startsWith('wechat:')?store.db.prepare('SELECT externalId FROM dialogue_sources WHERE scope=? AND messageId=?').get(r.scope,id)?.externalId??(row.role==='assistant'?row.source:null):row.source;
    if(!source)continue;out.push({rowId:id,id:String(source),key:stamp(row),text:row.text.slice(0,90),speaker:row.speaker});
  }return out;
}
export function quotePrompt(candidates){return candidates.length?'\n多人交错、需要指出回应哪条原文时，可在reply最开头用[QUOTE_SOURCE:key]选择下面的一条真实来源；普通接话无需引用。只可选择给出的key，不能改变引用原文。quoteCandidates='+JSON.stringify(candidates.map(({key,text,speaker})=>({key,text,speaker}))):'';}
export function quotePlan(text,candidates){const raw=String(text??''),match=/^\s*\[QUOTE_SOURCE:([a-f0-9]{64})\]\s*/u.exec(raw),quote=match?candidates.find(c=>c.key===match[1])??null:null;return {text:raw.replace(/\[QUOTE_SOURCE:[^\]\r\n]{0,180}\]\s*/gu,''),quote};}
export function assertQuote(store,quote,scope,context){if(!quote)return;const row=store.db.prepare('SELECT * FROM messages WHERE id=?').get(quote.rowId);if(!row||row.scope!==scope||stamp(row)!==quote.key||store.living.blocked(row.id)||!store.shared.messageAllowed(row.id,context))throw Object.assign(Error('引用来源已删除、遗忘或授权改变'),{deliveryAttempted:false});}
