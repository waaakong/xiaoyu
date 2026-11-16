import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),notes=JSON.parse(fs.readFileSync(path.join(root,'release-notes.json'),'utf8'));
test('release notes keep version lists and a valid, unique change log',()=>{
 assert.ok(Array.isArray(notes.changes));
 const ids=new Set();let previous=0;
 for(const entry of notes.changes){
  assert.match(entry.id,/^\d{4}-\d{2}-\d{2}-[a-z0-9-]+$/);
  assert.equal(ids.has(entry.id),false,'duplicate change id: '+entry.id);ids.add(entry.id);
  assert.equal(typeof entry.title,'string');assert.ok(entry.title.trim()&&entry.title.length<=80,'invalid title: '+entry.id);
  assert.ok(Array.isArray(entry.notes)&&entry.notes.length>0&&entry.notes.length<=12,'invalid notes: '+entry.id);
  for(const note of entry.notes){assert.equal(typeof note,'string');assert.ok(note.trim()&&note.length<=500,'invalid note: '+entry.id);}
  const at=Date.parse(entry.at);assert.equal(Number.isFinite(at),true,'invalid at: '+entry.id);assert.ok(at>=previous,'change log must be chronological: '+entry.id);previous=at;
 }
 for(const [version,list] of Object.entries(notes))if(version!=='changes'){assert.ok(Array.isArray(list)&&list.every(x=>typeof x==='string'),'invalid version notes: '+version);}
});
