import {parseScope} from './chat-identity.js';
export function initMemeState(db){db.exec(`
 CREATE TABLE IF NOT EXISTS meme_visuals(hash TEXT PRIMARY KEY,perceptual TEXT,analysis TEXT,updated INTEGER);
 CREATE TABLE IF NOT EXISTS meme_owned(assetId TEXT PRIMARY KEY,domain TEXT,personaId TEXT,hash TEXT,enabled INTEGER DEFAULT 1,shared INTEGER DEFAULT 0,reason TEXT,created INTEGER,UNIQUE(domain,personaId,hash));
 CREATE TABLE IF NOT EXISTS meme_origins(assetId TEXT,scope TEXT,sourceId INTEGER,PRIMARY KEY(assetId,scope,sourceId));
 CREATE TABLE IF NOT EXISTS meme_decisions(id INTEGER PRIMARY KEY,scope TEXT,personaId TEXT,sourceId INTEGER,hash TEXT,status TEXT,reason TEXT,created INTEGER);
 CREATE TABLE IF NOT EXISTS meme_daily(day TEXT PRIMARY KEY,images INTEGER DEFAULT 0,tokens INTEGER DEFAULT 0,reserved INTEGER DEFAULT 0);
 CREATE TABLE IF NOT EXISTS meme_jobs(id TEXT PRIMARY KEY,scope TEXT,personaId TEXT,status TEXT,reason TEXT,created INTEGER,finished INTEGER);
`);}
export function ownedMemeAllowed(store,id,scope,personaId){
 const owner=store.db.prepare('SELECT * FROM meme_owned WHERE assetId=?').get(id);if(!owner)return !store.asset(id)?.libraryId?.startsWith('person-memes-');
 let identity;try{identity=parseScope(scope);}catch{return false;}
 if(!owner.enabled||owner.personaId!==personaId||owner.domain!==identity.platform+':'+identity.account)return false;
 const origins=store.db.prepare('SELECT * FROM meme_origins WHERE assetId=?').all(id);
 return origins.some(o=>(owner.shared||o.scope===scope)&&store.source(o.sourceId)?.scope===o.scope&&!store.living.blocked(o.sourceId));
}
