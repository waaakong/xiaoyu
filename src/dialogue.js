import {createHash,randomUUID} from 'node:crypto';
import {validId,parseScope} from './chat-identity.js';
import {naturalChatText} from './chat-rhythm.js';
import {conversationWindow,isConversationQuestion} from './conversation-focus.js';
const identity=s=>{try{const value=JSON.parse(s);return value&&typeof value==='object'?value:{id:String(s??'')};}catch{return {id:String(s??'')};}};
const question=isConversationQuestion;
export const CONTEXT_NOTICE='结合conversationFocus、引用和已投递的前文理解省略、追问与纠正。当前具体问题、明确引用、最近同一发言者的问题优先于更早话题和记忆。短句有anchor就接着该对象，不因旧事更显眼而换题；没有可靠对象才具体澄清。区分消息收到和回复发出的先后，不能把用户在回复前发出的追问当作看过该回复后的新话题。分清谁在问谁、问题是否已回答，不把甲的经历记到乙名下。插件补充历史不能替换当前问题或指代对象。';
export function queuedParts(entry,pending){const parts=[entry];if(entry.r.policy.contextLinking===false||entry.r.policy.mergeQueued===false)return parts;for(const next of pending){if(next===entry)continue;if(next.absorbed)continue;if(parts.length>=3||next.r.user!==entry.r.user||next.r.policy.personaId!==entry.r.policy.personaId||next.r.policy.engine!==entry.r.policy.engine||next.r.policy.model!==entry.r.policy.model||next.quoteId!==entry.quoteId||next.r.hasImages||next.r.hasAudio||next.r.hasForward||next.r.social||entry.r.hasImages||entry.r.hasAudio||entry.r.hasForward||entry.r.social||/^\//u.test(next.r.text)||/^\//u.test(entry.r.text)||Math.abs(next.receivedAt-entry.receivedAt)>(entry.r.policy.rhythmMode==='social'?3000:1500)||parts.reduce((n,x)=>n+x.r.text.length,0)+next.r.text.length>1500)break;next.absorbed=true;parts.push(next);}return parts;}
export class Dialogue {
  constructor(store,{now=Date.now}={}){this.store=store;this.db=store.db;this.now=now;this.db.exec(`CREATE TABLE IF NOT EXISTS dialogue_links(messageId INTEGER PRIMARY KEY,scope TEXT,replyToId INTEGER,mentions TEXT DEFAULT '[]');CREATE TABLE IF NOT EXISTS dialogue_sources(scope TEXT,externalId TEXT,messageId INTEGER,PRIMARY KEY(scope,externalId));CREATE TABLE IF NOT EXISTS mention_attempts(id TEXT PRIMARY KEY,scope TEXT,memberId TEXT,state TEXT,at INTEGER);CREATE INDEX IF NOT EXISTS mention_scope ON mention_attempts(scope,memberId,at);CREATE INDEX IF NOT EXISTS messages_scope_run ON messages(scope,runId,role,id);`);}
  alias(id,scope,source){if(typeof source==='string'&&/^[1-9]\d{0,19}$/.test(source))this.db.prepare('INSERT OR IGNORE INTO dialogue_sources VALUES(?,?,?)').run(scope,source,id);}
  quoted(scope,source){const row=this.db.prepare('SELECT m.id,m.role,m.text,m.speaker FROM dialogue_sources d JOIN messages m ON m.id=d.messageId WHERE d.scope=? AND m.scope=? AND d.externalId=?').get(scope,scope,String(source));return row&&!this.store.living.blocked(row.id)?row:null;}
  link(id,scope,{replyToId=null,mentions=[]}={}){this.db.prepare('INSERT OR REPLACE INTO dialogue_links VALUES(?,?,?,?)').run(id,scope,replyToId,JSON.stringify(mentions.slice(0,20)));}
  record(id,scope,data){this.store.meta('dialogue-route:'+id,JSON.stringify({messageId:id,scope,...data}));this.db.exec("DELETE FROM meta WHERE key LIKE 'dialogue-route:%' AND key NOT IN (SELECT key FROM meta WHERE key LIKE 'dialogue-route:%' ORDER BY CAST(substr(key,16) AS INTEGER) DESC LIMIT 1000)");}
  diagnostics(scope){return this.db.prepare("SELECT value FROM meta WHERE key LIKE 'dialogue-route:%' AND json_extract(value,'$.scope')=? ORDER BY CAST(substr(key,16) AS INTEGER) DESC LIMIT 20").all(scope).map(r=>JSON.parse(r.value));}
  history(scope,before,limit,budget,personaId=null){
    const rows=this.db.prepare(`SELECT m.*,l.replyToId,l.mentions,coalesce((SELECT min(u.id) FROM messages u WHERE u.scope=m.scope AND u.runId=m.runId AND u.role='user'),m.id) anchor FROM messages m LEFT JOIN dialogue_links l ON l.messageId=m.id WHERE m.scope=? AND (? IS NULL OR m.personaId=?) AND m.id>? AND m.status IN ('observed','received','delivered') AND NOT EXISTS(SELECT 1 FROM memory_blocked b WHERE b.messageId=m.id) AND (m.id<? OR m.role='assistant' AND m.status='delivered' AND m.runId IS NOT NULL AND EXISTS(SELECT 1 FROM messages u WHERE u.scope=m.scope AND u.runId=m.runId AND u.role='user' AND u.id<?)) ORDER BY anchor DESC,CASE WHEN m.role='assistant' THEN 1 ELSE 0 END DESC,m.id DESC LIMIT ?`).all(scope,personaId,personaId,Number(this.store.meta('memory-reset-through')??-1),before,before,Math.min(160,limit*4));
    const member=String(identity(this.store.source(before)?.speaker).id??''),ownRuns=new Set(rows.filter(r=>r.role==='user'&&String(identity(r.speaker).id)===member).map(r=>r.runId).filter(Boolean)),prioritized=[...rows.filter(r=>r.role==='user'&&String(identity(r.speaker).id)===member||r.runId&&ownRuns.has(r.runId)).slice(0,6),...rows];let chars=0;const chosen=new Set();for(const r of prioritized){if(chosen.size>=limit)break;if(chosen.has(r.id)||this.store.living.blocked(r.id)||chars+r.text.length>budget)continue;chosen.add(r.id);chars+=r.text.length;}return rows.filter(r=>chosen.has(r.id)).reverse().map(({anchor,mentions,...r})=>({...r,mentions:JSON.parse(mentions??'[]')}));
  }
  candidates(r,history){const members=new Map(),platform=parseScope(r.scope).platform;
    for(const row of [...history.filter(h=>h.role==='user'),{speaker:r.speaker}]){const s=identity(row.speaker),id=String(s.id??'');if(!validId(id,platform)||id===r.account||id==='all')continue;const name=String(s.name??id).trim();if(!name||name.length>80||/[\x00-\x1f\u2005]/u.test(name))continue;members.set(id,{id,name,key:createHash('sha256').update(r.scope+'\0'+id).digest('hex')});}
    return [...members.values()].slice(-20);
  }
  focus(r,history,quote){const speakers=[...new Set(history.filter(x=>x.role==='user').map(x=>String(identity(x.speaker).id)).filter(Boolean))].slice(-5),answered=new Set(history.filter(x=>x.role==='assistant'&&x.runId).map(x=>x.runId));const outstanding=history.filter(x=>x.role==='user'&&x.status==='received'&&question(x.text)&&!answered.has(x.runId)&&String(identity(x.speaker).id)===r.user).slice(-2).map(x=>({id:x.id,text:x.text.slice(0,180),notice:'此前未见成功回复，不代表仍需重复回答'}));
    return {currentSpeakerId:r.user,...(quote?{quotedMessageId:quote.id,quotedSpeaker:identity(quote.speaker).id??quote.role}:{}),recentSpeakerIds:speakers,...(outstanding.length?{previousUnanswered:outstanding}:{}),...(r.turnParts?.length>1?{combinedSourceIds:r.turnParts.map(x=>x.id)}:{}),notice:'联系前文明确对象；其他成员的发言只是群内背景，不等于向角色提问。'};
  }
  window(r,history,quote){const currentId=r.turnParts?.[0]?.id,current=Number.isSafeInteger(currentId)?this.store.source(currentId):null,window=conversationWindow(r,history,quote,{current});window.focus={...this.focus(r,window.history,quote),...window.focus};return window;}
  prompt(r,history){if(!r.group||r.policy.groupMentionMode==='off')return '';const candidates=this.candidates(r,history);return '\n群聊定向回复：明确回答某位群友且需要提醒或区分对象时，可在reply最开头加[REPLY_TO:成员键]。只选下列本群已核验发言者。普通全群闲聊、连续接话、仅谈及第三人时不加，不@全体。正文不用重复@名字。程序移除标记并控制真实@与冷却，不支持时仍发正常文字。\n'+candidates.map(c=>JSON.stringify({key:c.key,name:c.name})).join('\n');}
  plan(r,reply,history,{nativeMention=true}={}){
    const candidates=r.group?this.candidates(r,history):[],hasControl=reply.includes('[REPLY_TO:'),marker=/^\s*\[REPLY_TO:([^\]\r\n]{1,100})\]\s*/u.exec(reply);let target=marker?candidates.find(c=>c.key===marker[1]):null,reason=marker?(target?'model-directed':'invalid-target'):'not-directed';
    let naturalPrefix=false,ambiguousName=false;const originalText=reply;let text=reply.replace(/^\s*\[REPLY_TO:[^\]\r\n]{0,100}\]\s*/u,'').replace(/\[REPLY_TO:[^\]\r\n]*(?:\]|$)/gmu,'').trim();
    if(!marker&&r.group){const unique=candidates.filter(c=>text.startsWith('@'+c.name+'\u2005')||text.startsWith(c.name+'，')||text.startsWith(c.name+',')||text.startsWith(c.name+'：'));if(unique.length>1){ambiguousName=true;reason='ambiguous-name';}if(unique.length===1){target=unique[0];naturalPrefix=true;reason='unique-name-directed';text=text.replace(new RegExp('^@?'+target.name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'[，,:：\\s]+','u'),'').trim();}}
    const mode=r.policy.groupMentionMode??'auto';
    if(!target&&!hasControl&&!ambiguousName&&r.group&&(mode==='always'||(r.at||question(r.text)&&new Set(history.filter(h=>h.role==='user').map(h=>identity(h.speaker).id)).size>1))&&!/大家|各位|全群/u.test(r.text)){target=candidates.find(c=>c.id===r.user);reason='current-question';}
    if(!r.group||mode==='off'){target=null;reason=r.group?'disabled':'private-chat';}
    if(/(?:别|不要|不用|不必)\s*[@＠]|不(?:要|用)艾特/u.test(r.text)){target=null;reason='requested-no-mention';}
    if(target&&!nativeMention){target=null;reason='transport-unsupported';}
    if(target&&this.cooling(r.scope,target.id,r.policy.mentionCooldownSeconds??600)){target=null;reason='cooldown';}
    if(!target&&naturalPrefix)text=originalText.replace(/^@/u,'').trim();
    if(r.policy.engine==='dsh')text=naturalChatText(text);
    if(!text)throw Error('定向回复移除控制标记后没有正文');
    const plan={text,target:target??null,reason,attemptId:null,scope:r.scope,cooldownSeconds:r.policy.mentionCooldownSeconds??600};
    return plan;
  }
  cooling(scope,id,seconds){return !!this.db.prepare('SELECT 1 FROM mention_attempts WHERE scope=? AND memberId=? AND at>? LIMIT 1').get(scope,id,this.now()-seconds*1000);}
  begin(plan){if(plan.attemptId||!plan.target||this.cooling(plan.scope,plan.target.id,plan.cooldownSeconds))return false;plan.attemptId=randomUUID();this.db.prepare('INSERT INTO mention_attempts VALUES(?,?,?,?,?)').run(plan.attemptId,plan.scope,plan.target.id,'unknown',this.now());return true;}
  confirmed(plan){if(plan.attemptId)this.db.prepare("UPDATE mention_attempts SET state='confirmed' WHERE id=?").run(plan.attemptId);}
}
