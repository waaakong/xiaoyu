import {createHash} from 'node:crypto';
import {parseScope,validId} from './chat-identity.js';

const fingerprint=r=>createHash('sha256').update(JSON.stringify([r.scope,r.personaId,r.role,r.speaker,r.text])).digest('hex');
const modes=new Set(['inherit','text','voice','smart']);
const addressedElsewhere=/[“「『"].*(?:语音|文字)|(?:他说|她说|转发|引用|有人说|你觉得|为什么|是不是|能不能|是否)/u;
export function preferenceInstruction(text){
  if(typeof text!=='string'||text.length>500||addressedElsewhere.test(text)||!/(?:记住|以后|今后|默认|从现在起|一直)/u.test(text))return null;
  if(/(?:取消|清除|忘掉|恢复).{0,10}(?:回复偏好|语音偏好|默认设置|原来设置)/u.test(text))return 'inherit';
  if(!/(?:你|回复|回答|和我|跟我)/u.test(text))return null;
  if(/(?:不要|不用|别|不再).{0,6}(?:发|用)?语音|(?:只|都|一律|尽量).{0,4}(?:用|发)?文字/u.test(text)&&!/(?:查资料|代码|链接|搜索).{0,15}文字/u.test(text))return 'text';
  if(/(?:语音|发语音)/u.test(text)&&/(?:查资料|资料|代码|链接|搜索|联网).{0,15}文字/u.test(text))return 'smart';
  if(/(?:用语音|发语音|语音回复|语音回答|语音说|语音和我|语音跟我)/u.test(text))return 'voice';
  return null;
}
export function needsWrittenAnswer(text,response){
  return /(?:查(?:一下|下)?资料|查找|搜索|联网|给.{0,8}链接|代码|表格|网址|参考文献|列出来源|阅读\s*https?:)/iu.test(text)||!!response?.searchUsed||response?.web?.operations?.some(x=>x.status==='ok')||/https?:\/\/|```|\|[^\n]+\|/u.test(response?.reply??'');
}
function owner(r){const p=parseScope(r.scope);if(p.member||!validId(String(r.user),p.platform)||!r.policy?.personaId)throw Error('回复偏好身份无效');return {scope:p.scope,personaId:r.policy.personaId,member:String(r.user)};}
export class ChatState {
  constructor(store){this.store=store;this.db=store.db;this.db.exec(`CREATE TABLE IF NOT EXISTS reply_preferences(scope TEXT,personaId TEXT,member TEXT,mode TEXT,sourceId INTEGER,revision INTEGER DEFAULT 1,updated INTEGER,PRIMARY KEY(scope,personaId,member));CREATE TABLE IF NOT EXISTS group_thread_state(scope TEXT,personaId TEXT,sourceIds TEXT,revision INTEGER DEFAULT 1,updated INTEGER,PRIMARY KEY(scope,personaId));CREATE TABLE IF NOT EXISTS group_summary_provenance(scope TEXT,personaId TEXT,endId INTEGER,sourceIds TEXT,text TEXT DEFAULT '',PRIMARY KEY(scope,personaId));`);if(!this.db.prepare('PRAGMA table_info(group_summary_provenance)').all().some(c=>c.name==='text'))this.db.exec("ALTER TABLE group_summary_provenance ADD COLUMN text TEXT DEFAULT ''");if(!this.db.prepare('PRAGMA table_info(group_summary_provenance)').all().some(c=>c.name==='sourceHashes'))this.db.exec("ALTER TABLE group_summary_provenance ADD COLUMN sourceHashes TEXT DEFAULT '{}'");}
  source(id){return this.db.prepare("SELECT * FROM messages WHERE id=?").get(id);}
  restore(r){
    const k=owner(r);if(parseScope(r.scope).kind!=='private'||this.get(r).revision)return;
    const rows=this.db.prepare("SELECT * FROM messages WHERE scope=? AND personaId=? AND role='user' AND status='received' AND id>CAST(coalesce((SELECT value FROM meta WHERE key='memory-reset-through'),'0') AS INTEGER) ORDER BY id DESC LIMIT 80").all(k.scope,k.personaId);
    for(const row of rows){let member;try{member=JSON.parse(row.speaker??'{}').id;}catch{}if(String(member)!==k.member||this.store.living.blocked(row.id)||this.store.shared.dependencies(row.id).length||this.store.continuity.dependencies(row.id).length||this.db.prepare('SELECT 1 FROM social_sources WHERE messageId=?').get(row.id)||/\[引用|引用上下文/u.test(row.text))continue;const mode=preferenceInstruction(row.text);if(mode){this.set(r,mode,row.id);break;}}
  }
  get(r){const k=owner(r);return this.db.prepare('SELECT * FROM reply_preferences WHERE scope=? AND personaId=? AND member=?').get(k.scope,k.personaId,k.member)??{...k,mode:'inherit',revision:0};}
  set(r,mode,sourceId=null){if(!modes.has(mode))throw Error('回复偏好无效');const k=owner(r);if(sourceId!==null){const row=this.source(sourceId);let member;try{member=JSON.parse(row?.speaker??'{}').id;}catch{}if(!row||row.scope!==k.scope||row.role!=='user'||String(member)!==k.member||row.personaId!==k.personaId||this.store.living.blocked(sourceId))throw Error('偏好来源不属于当前发言者');}
    this.db.prepare('INSERT INTO reply_preferences VALUES(?,?,?,?,?,1,?) ON CONFLICT(scope,personaId,member) DO UPDATE SET mode=excluded.mode,sourceId=excluded.sourceId,revision=reply_preferences.revision+1,updated=excluded.updated').run(k.scope,k.personaId,k.member,mode,sourceId,Date.now());return this.get(r);
  }
  learn(r,sourceId){if(r.hasForward||r.social||r.event?.message?.some(s=>s.type==='reply')||r.groupAddressing?.reason==='addressed-to-other')return null;const mode=preferenceInstruction(r.text);return mode?this.set(r,mode,sourceId):null;}
  mode(r,policy=r.policy,response){const pref=this.get(r);if(r.replyPreferenceRevision!=null&&r.replyPreferenceRevision!==pref.revision)throw Error('回复偏好已改变');if(policy.voiceMode==='off'||!policy.voiceMode)return 'off';
    if(/(?:这条|这次|本条|现在).{0,12}(?:用|发)?文字|(?:请|只|直接)用文字(?:回复|回答|说)/u.test(r.text))return 'off';
    if(/(?:这条|这次|本条).{0,12}(?:用|发)?语音|(?:请|只|直接)用语音(?:回复|回答|说)/u.test(r.text))return 'only';
    if(pref.mode==='text')return 'off';if(pref.mode==='voice')return 'only';if(pref.mode==='smart')return needsWrittenAnswer(r.text,response??r.replyResponse)?'off':'only';return policy.voiceMode;
  }
  preferencePrompt(r){const p=this.get(r);return p.mode==='inherit'?'':(r.policy.voiceMode==='off'?'\n当前聊天语音发送开关关闭：偏好已保存但暂不执行，不承诺已发语音。':'')+`\n本聊天对此成员的持久回复偏好=${p.mode}（smart=闲聊语音，资料文字）。实际发送由程序依据授权控制；不要虚称已经发送。`+(p.sourceId?` 来源消息#${p.sourceId}。`:'');}
  observe(r,id){if(!r.group)return;const row=this.source(id);if(!row||row.scope!==r.scope||row.personaId!==r.policy.personaId)return;const ids=this.view(r.scope,r.policy.personaId).messages.map(m=>m.id);ids.push(id);this.db.prepare('INSERT INTO group_thread_state VALUES(?,?,?,1,?) ON CONFLICT(scope,personaId) DO UPDATE SET sourceIds=excluded.sourceIds,revision=group_thread_state.revision+1,updated=excluded.updated').run(r.scope,r.policy.personaId,JSON.stringify([...new Set(ids)].slice(-12)),Date.now());}
  view(scope,personaId){if(parseScope(scope).kind!=='group')return {scope,personaId,messages:[],summary:null};const state=this.db.prepare('SELECT * FROM group_thread_state WHERE scope=? AND personaId=?').get(scope,personaId),ids=state?JSON.parse(state.sourceIds):this.db.prepare("SELECT id FROM messages WHERE scope=? AND personaId=? AND status IN ('received','observed','delivered') ORDER BY id DESC LIMIT 12").all(scope,personaId).map(r=>r.id).reverse(),summary=this.db.prepare('SELECT * FROM group_summary_provenance WHERE scope=? AND personaId=?').get(scope,personaId);const messages=ids.map(id=>this.source(id)).filter(r=>r&&r.scope===scope&&r.personaId===personaId&&!this.store.living.blocked(r.id)&&!this.store.shared.dependencies(r.id).length&&!this.store.continuity.dependencies(r.id).length).map(r=>({id:r.id,role:r.role,speaker:r.speaker,text:r.text.slice(0,240),created:r.created}));return {scope,personaId,revision:state?.revision??0,updated:state?.updated??null,messages,summary:summary?{...summary,sourceIds:JSON.parse(summary.sourceIds),text:this.summary(scope,personaId)}:null};}
  summary(scope,personaId){const p=this.db.prepare('SELECT * FROM group_summary_provenance WHERE scope=? AND personaId=?').get(scope,personaId);if(!p)return '';const hashes=JSON.parse(p.sourceHashes??'{}');return JSON.parse(p.sourceIds).every(id=>{const r=this.source(id);return r&&r.scope===scope&&r.personaId===personaId&&hashes[id]===fingerprint(r)&&!this.store.living.blocked(id)&&!this.store.shared.dependencies(id).length&&!this.store.continuity.dependencies(id).length;})?p.text:'';}
  summaryRows(scope,personaId,through){const p=this.db.prepare('SELECT endId FROM group_summary_provenance WHERE scope=? AND personaId=?').get(scope,personaId);return this.db.prepare("SELECT * FROM messages WHERE scope=? AND personaId=? AND id>? AND id<=? AND status IN ('received','observed','delivered') AND NOT EXISTS(SELECT 1 FROM memory_blocked b WHERE b.messageId=messages.id) AND NOT EXISTS(SELECT 1 FROM shared_message_refs r WHERE r.messageId=messages.id) AND NOT EXISTS(SELECT 1 FROM continuity_message_refs r WHERE r.messageId=messages.id) ORDER BY id LIMIT 60").all(scope,personaId,p?.endId??0,through);}
  stampSummary(scope,personaId,endId,rows,text){const old=this.db.prepare('SELECT sourceIds FROM group_summary_provenance WHERE scope=? AND personaId=?').get(scope,personaId),ids=[...new Set([...(old&&this.summary(scope,personaId)?JSON.parse(old.sourceIds):[]),...rows.map(r=>r.id)])];if(!ids.every(id=>{const r=this.source(id);return r?.scope===scope&&r.personaId===personaId&&!this.store.living.blocked(id);}))throw Error('群摘要来源已改变');const hashes=Object.fromEntries(ids.map(id=>[id,fingerprint(this.source(id))]));this.db.prepare('INSERT OR REPLACE INTO group_summary_provenance(scope,personaId,endId,sourceIds,text,sourceHashes) VALUES(?,?,?,?,?,?)').run(scope,personaId,endId,JSON.stringify(ids),text.slice(0,2000),JSON.stringify(hashes));}
  prompt(r,history){
    r.groupContextBinding=null;
    if(!r.group||r.policy.contextLinking===false||!/(?:上次|之前|本群|这个群|接着.{0,6}聊|继续.{0,6}话题)/u.test(r.text))return '';
    const budget=Math.min(700,Math.floor((r.policy.memoryChars??1600)/2)),seen=new Set(history.map(m=>m.id)),view=this.view(r.scope,r.policy.personaId),rows=view.messages.filter(m=>!seen.has(m.id)&&m.id<(r.turnParts?.[0]?.id??Infinity)).slice(-4),refs=[];
    let text='\n本群旧话题回顾（有来源，不能替换当前明确问题）：\n';
    const summary=view.summary?.text??'';
    if(summary){const line='本群长期摘要：'+summary.slice(0,Math.min(350,Math.max(0,budget-text.length-20)))+'\n';if(text.length+line.length<=budget)text+=line;}
    for(const row of rows){const line=JSON.stringify({...row,text:row.text.slice(0,120)})+'\n';if(text.length+line.length>budget)continue;text+=line;refs.push({id:row.id,hash:fingerprint(this.source(row.id))});}
    if(!refs.length&&!summary)return '';
    r.groupContextBinding={scope:r.scope,personaId:r.policy.personaId,refs,summaryHash:summary?createHash('sha256').update(summary).digest('hex'):null};return text.slice(0,budget);
  }
  fresh(r){const p=r.groupContextBinding;if(!p)return true;return p.scope===r.scope&&p.personaId===r.policy.personaId&&p.refs.every(ref=>{const row=this.source(ref.id);return row&&row.scope===p.scope&&row.personaId===p.personaId&&fingerprint(row)===ref.hash&&!this.store.living.blocked(row.id)&&!this.store.shared.dependencies(row.id).length&&!this.store.continuity.dependencies(row.id).length;})&&(!p.summaryHash||createHash('sha256').update(this.summary(p.scope,p.personaId)).digest('hex')===p.summaryHash);}
  reset(scope){this.db.prepare('DELETE FROM group_thread_state WHERE scope=?').run(scope);this.db.prepare('DELETE FROM group_summary_provenance WHERE scope=?').run(scope);}
  list(scope,personaId){return this.db.prepare('SELECT * FROM reply_preferences WHERE scope=? AND personaId=? ORDER BY updated DESC LIMIT 100').all(scope,personaId);}
}
