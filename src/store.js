import {ChatState} from './chat-state.js';
import {Continuity} from './continuity.js';
import {fixedMemoryPrompt} from './fixed-memory.js';
import {withSocialBoundaries} from './persona-social.js';
import {Emotion} from './emotion.js';
import {Dialogue} from './dialogue.js';
import {createHash} from 'node:crypto';
import {Cognition} from './cognition.js';
import {SharedMemory} from './shared-memory.js';
import {LivingMemory} from './living-memory.js';
import {DatabaseSync} from 'node:sqlite';
export class Store {
  constructor(file) {
    this.db=new DatabaseSync(file);
    this.db.exec(`PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS messages(id INTEGER PRIMARY KEY, scope TEXT NOT NULL, role TEXT, text TEXT, status TEXT, created TEXT DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE IF NOT EXISTS memories(id INTEGER PRIMARY KEY, scope TEXT NOT NULL, key TEXT, value TEXT, updated TEXT DEFAULT CURRENT_TIMESTAMP, UNIQUE(scope,key));
      CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY, created INTEGER);
      CREATE TABLE IF NOT EXISTS paused(scope TEXT PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS usage(id INTEGER PRIMARY KEY,scope TEXT,data TEXT,created TEXT DEFAULT CURRENT_TIMESTAMP);`);
    for(const [table,column,type]of [['messages','personaId','TEXT'],['messages','personaVersion','TEXT'],['messages','runId','TEXT'],['messages','speaker','TEXT'],['messages','source','TEXT'],['memories','sourceId','INTEGER'],['memories','evidence','TEXT'],['memories','expires','INTEGER'],['memories','pinned','INTEGER DEFAULT 0']]){
      if(!this.db.prepare(`PRAGMA table_info(${table})`).all().some(c=>c.name===column))this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
    }
    this.db.exec(`CREATE TABLE IF NOT EXISTS contacts(account TEXT,kind TEXT,peer TEXT,name TEXT,updated TEXT DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(account,kind,peer));
      CREATE TABLE IF NOT EXISTS personas(id TEXT PRIMARY KEY,name TEXT,category TEXT,text TEXT,updated TEXT DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE IF NOT EXISTS assets(id TEXT PRIMARY KEY,name TEXT,tags TEXT,kind TEXT,ext TEXT,size INTEGER,created TEXT DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE IF NOT EXISTS summaries(scope TEXT PRIMARY KEY,endId INTEGER,text TEXT,updated TEXT DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT);
      CREATE TABLE IF NOT EXISTS receipts(scope TEXT,source TEXT,rowId INTEGER,PRIMARY KEY(scope,source));
      CREATE TABLE IF NOT EXISTS social_sources(messageId INTEGER PRIMARY KEY,kind TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS fixed_memories(id TEXT PRIMARY KEY,text TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS messages_scope_id ON messages(scope,id); CREATE INDEX IF NOT EXISTS memories_scope ON memories(scope);`);
    this.db.exec("CREATE TABLE IF NOT EXISTS libraries(id TEXT PRIMARY KEY,name TEXT,description TEXT DEFAULT '',source TEXT DEFAULT '',license TEXT DEFAULT '',enabled INTEGER DEFAULT 1,scope TEXT DEFAULT '',created TEXT DEFAULT CURRENT_TIMESTAMP)");
    for(const [column,type]of [['libraryId',"TEXT DEFAULT 'local'"],['mood',"TEXT DEFAULT 'daily'"],['caption',"TEXT DEFAULT ''"],['hash',"TEXT DEFAULT ''"]])if(!this.db.prepare('PRAGMA table_info(assets)').all().some(c=>c.name===column))this.db.exec(`ALTER TABLE assets ADD COLUMN ${column} ${type}`);
    for(const column of ['format','keySet','packRef','digest'])if(!this.db.prepare('PRAGMA table_info(libraries)').all().some(c=>c.name===column))this.db.exec("ALTER TABLE libraries ADD COLUMN "+column+" TEXT DEFAULT ''");
    if(!this.db.prepare('PRAGMA table_info(assets)').all().some(c=>c.name==='semanticKey'))this.db.exec("ALTER TABLE assets ADD COLUMN semanticKey TEXT DEFAULT ''");
    this.db.prepare("INSERT OR IGNORE INTO libraries(id,name,description) VALUES('local','本地素材','原有图片和表情，完整保留')").run();
    this.living=new LivingMemory(this);this.shared=new SharedMemory(this);this.continuity=new Continuity(this);this.cognition=new Cognition(this);this.emotion=new Emotion(this);this.dialogue=new Dialogue(this);this.chatState=new ChatState(this);
  }
  once(id) {
    this.db.prepare('DELETE FROM events WHERE created < ?').run(Date.now()-86400000);
    return this.db.prepare('INSERT OR IGNORE INTO events VALUES(?,?)').run(id,Date.now()).changes > 0;
  }
  add(scope,role,text,status='delivered',speaker='',source='') {const id=Math.max(Number(this.meta('message-sequence')??0),this.db.prepare('SELECT coalesce(max(id),0) AS n FROM messages').get().n)+1;this.db.prepare('INSERT INTO messages(id,scope,role,text,status,speaker,source) VALUES(?,?,?,?,?,?,?)').run(id,scope,role,text,status,String(speaker),String(source));this.meta('message-sequence',id);this.living.indexMessage({id,scope,role,text,status,speaker});return id;}
  markSocial(id,kind){this.db.prepare("INSERT OR REPLACE INTO social_sources VALUES(?,?)").run(id,kind);this.db.prepare("DELETE FROM episode_terms WHERE messageId=?").run(id);}
  tagTurn(id,personaId,runId,personaText=''){this.db.prepare('UPDATE messages SET personaId=?,personaVersion=?,runId=? WHERE id=?').run(personaId,personaText?createHash('sha256').update(personaText).digest('hex'):null,runId,id);}
  status(id,status) {this.db.prepare('UPDATE messages SET status=? WHERE id=?').run(status,id);const r=this.db.prepare('SELECT * FROM messages WHERE id=?').get(id);if(r)this.living.indexMessage(r);}
  history(scope,limit,before=Number.MAX_SAFE_INTEGER,charBudget=40000) {const rows=this.db.prepare("SELECT id,role,text,speaker,created,status,personaId,personaVersion,runId FROM messages WHERE scope=? AND id<? AND status IN ('observed','received','delivered') ORDER BY id DESC LIMIT ?").all(scope,before,limit);let n=0;return rows.filter(r=>{if(this.living.blocked(r.id))return false;n+=r.text.length;return n<=charBudget;}).reverse();}
  memories(scope) {return this.db.prepare('SELECT * FROM memories WHERE scope=? AND (expires IS NULL OR expires>?) ORDER BY id DESC LIMIT 500').all(scope,Date.now());}
  remember(scope,key,value,options={}) {return this.living.remember(scope,key,value,options);}
  forget(scope,id) {return this.living.forget(scope,id);}
  recall(scope,query,budget) {let result='';for(const m of this.living.candidates(scope,query).slice(0,8)){const line=m.key+': '+m.value+'\n';if(result.length+line.length<=budget)result+=line;}return result;}
  isPaused(scope) {return Boolean(this.db.prepare('SELECT 1 FROM paused WHERE scope=?').get(scope));}
  pause(scope,on) {if(on)this.db.prepare('INSERT OR IGNORE INTO paused VALUES(?)').run(scope);else this.db.prepare('DELETE FROM paused WHERE scope=?').run(scope);}
  reset(scope) {this.chatState.reset(scope);this.db.prepare('DELETE FROM episode_terms WHERE scope=?').run(scope);this.db.prepare('DELETE FROM messages WHERE scope=?').run(scope);this.db.prepare('DELETE FROM summaries WHERE scope=?').run(scope);this.db.prepare('DELETE FROM receipts WHERE scope=?').run(scope);}
  clearMemory(scope) {for(const m of this.db.prepare('SELECT id FROM memories WHERE scope=?').all(scope))this.forget(scope,m.id);}
  usage(scope,data) {this.db.prepare('INSERT INTO usage(scope,data) VALUES(?,?)').run(scope,JSON.stringify(data));}
  meta(key,value){if(value!==undefined)this.db.prepare('INSERT INTO meta VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,String(value));return this.db.prepare('SELECT value FROM meta WHERE key=?').get(key)?.value;}
  contacts(account){return this.db.prepare('SELECT * FROM contacts WHERE account=? ORDER BY kind,name').all(String(account));}
  setContacts(account,kind,rows){const s=this.db.prepare('INSERT INTO contacts(account,kind,peer,name) VALUES(?,?,?,?) ON CONFLICT(account,kind,peer) DO UPDATE SET name=excluded.name,updated=CURRENT_TIMESTAMP');this.db.exec('BEGIN');try{this.db.prepare('DELETE FROM contacts WHERE account=? AND kind=?').run(account,kind);for(const r of rows)s.run(account,kind,String(r.id),r.name.slice(0,120));this.db.exec('COMMIT');}catch(e){this.db.exec('ROLLBACK');throw e;}}
  touchContact(account,kind,peer,name){this.db.prepare('INSERT INTO contacts(account,kind,peer,name) VALUES(?,?,?,?) ON CONFLICT(account,kind,peer) DO NOTHING').run(account,kind,peer,name.slice(0,120));}
  personas(){return this.db.prepare('SELECT * FROM personas ORDER BY category,name').all();}
  fixedMemories(){return this.db.prepare('SELECT id,text FROM fixed_memories ORDER BY rowid').all();}
  personaInstructions(text,member,context){return withSocialBoundaries(text)+fixedMemoryPrompt(this,member,context);}
  persona(id){return this.db.prepare('SELECT * FROM personas WHERE id=?').get(id);}
  savePersona({id,name,category,text}){this.db.prepare('INSERT INTO personas(id,name,category,text) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,category=excluded.category,text=excluded.text,updated=CURRENT_TIMESTAMP').run(id,name,category,text);this.cognition?.snapshot({id,name,category,text});}
  deletePersona(id){this.db.prepare('DELETE FROM personas WHERE id=?').run(id);}
  assets(){return this.db.prepare('SELECT * FROM assets ORDER BY created DESC').all().map(a=>({...a,tags:JSON.parse(a.tags)}));}
  asset(id){const a=this.db.prepare('SELECT * FROM assets WHERE id=?').get(id);return a?{...a,tags:JSON.parse(a.tags)}:null;}
  saveAsset(a){this.db.prepare('INSERT INTO assets(id,name,tags,kind,ext,size,libraryId,mood,caption,hash,semanticKey) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(a.id,a.name,JSON.stringify(a.tags),a.kind,a.ext,a.size,a.libraryId??'local',a.mood??'daily',a.caption??'',a.hash??'',a.semanticKey??'');}
  libraries(){return this.db.prepare('SELECT l.*,count(a.id) AS count,coalesce(sum(a.size),0) AS bytes FROM libraries l LEFT JOIN assets a ON a.libraryId=l.id GROUP BY l.id ORDER BY l.created,l.name').all().map(l=>({...l,enabled:!!l.enabled}));}
  library(id){return this.libraries().find(l=>l.id===id)??null;}
  saveLibrary(l){this.db.prepare('INSERT INTO libraries(id,name,description,source,license,enabled,scope,format,keySet,packRef,digest) VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,description=excluded.description,source=excluded.source,license=excluded.license,enabled=excluded.enabled,scope=excluded.scope,format=excluded.format,keySet=excluded.keySet,packRef=excluded.packRef,digest=excluded.digest').run(l.id,l.name,l.description??'',l.source??'',l.license??'',l.enabled===false?0:1,l.scope??'',l.format??'',l.keySet??'',l.packRef??'',l.digest??'');return this.library(l.id);}
  deleteAsset(id){this.db.prepare('DELETE FROM assets WHERE id=?').run(id);}
  summary(scope){return this.db.prepare('SELECT * FROM summaries WHERE scope=?').get(scope)??{scope,endId:0,text:''};}
  saveSummary(scope,endId,text){this.db.prepare('INSERT INTO summaries(scope,endId,text) VALUES(?,?,?) ON CONFLICT(scope) DO UPDATE SET endId=excluded.endId,text=excluded.text,updated=CURRENT_TIMESTAMP').run(scope,endId,text.slice(0,2000));}
  summaryRows(scope,through){const last=this.summary(scope);return this.db.prepare("SELECT id,role,speaker,text,personaId FROM messages WHERE scope=? AND id>? AND id<=? AND status IN ('received','observed','delivered') AND NOT EXISTS(SELECT 1 FROM memory_blocked b WHERE b.messageId=messages.id) AND NOT EXISTS(SELECT 1 FROM shared_message_refs sr WHERE sr.messageId=messages.id) AND NOT EXISTS(SELECT 1 FROM continuity_message_refs cr WHERE cr.messageId=messages.id) ORDER BY id LIMIT 60").all(scope,last.endId,through);}
  historyPage(scope,before=Number.MAX_SAFE_INTEGER){return this.db.prepare('SELECT id,role,text,speaker,status,created FROM messages WHERE scope=? AND id<? ORDER BY id DESC LIMIT 80').all(scope,before);}
  memoryPage(scope){return this.db.prepare("SELECT m.*,(SELECT id FROM shared_facts sf WHERE sf.memoryId=m.id AND sf.active=1) AS sharedFactId,(SELECT count(*) FROM memory_versions v WHERE v.memoryId=m.id AND v.status='pending') AS pending FROM memories m WHERE scope=? OR substr(scope,1,length(?)+8)=?||':member:' ORDER BY updated DESC,id DESC").all(scope,scope,scope);}
  deleteMemory(id){const m=this.memory(id);return m?this.forget(m.scope,id):0;}
  memory(id){return this.db.prepare('SELECT * FROM memories WHERE id=?').get(id);}
  source(id){return this.db.prepare('SELECT id,scope,speaker,text,created FROM messages WHERE id=?').get(id);}
  quoted(scope,source){return this.db.prepare('SELECT id,role,text,speaker FROM messages WHERE NOT EXISTS(SELECT 1 FROM memory_blocked b WHERE b.messageId=messages.id) AND scope=? AND (source=? OR id IN (SELECT rowId FROM receipts WHERE scope=? AND source=?)) ORDER BY id DESC LIMIT 1').get(scope,String(source),scope,String(source));}
  setSource(id,source){this.db.prepare('UPDATE messages SET source=? WHERE id=?').run(String(source),id);}
  setReceipts(id,receipts){const row=this.db.prepare('SELECT scope FROM messages WHERE id=?').get(id);if(!row)return;for(const r of receipts??[])if(r?.message_id!=null)this.db.prepare('INSERT OR REPLACE INTO receipts VALUES(?,?,?)').run(row.scope,String(r.message_id),id);}
  usagePage(scope){return this.db.prepare('SELECT * FROM usage WHERE scope=? ORDER BY id DESC LIMIT 40').all(scope).map(r=>({...r,data:JSON.parse(r.data)}));}
  close(){this.db.close();}
}
