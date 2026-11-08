// Only queries the already-published test object. Never constructs a post.
import fs from 'node:fs';import path from 'node:path';
import {loadConfig} from '../src/config.js';
import {MomentsClient} from '../src/wechat-moments.js';
import {parseMomentsObject,sha256} from '../src/wechat-moments-protocol.js';
const base=path.join(loadConfig().dataDir,'wechat-moments-research'),read=name=>JSON.parse(fs.readFileSync(path.join(base,name),'utf8'));
const proposal=read('proposals/8b04679f-1ff1-416e-b4fa-e8334d8c0bc6.json'),original=read('proposals/9776c401-b043-4a3c-8604-30cae34fd976.json'),session=read('session.json');
if(proposal.kind!=='detail'||proposal.objectId!=='15049007838569247391'||proposal.account!==original.account||session.operation!=='detail'||session.proposalId!==proposal.id||session.dllSha256!=='682a9946cf60deeec55e443cb525bf1918116d71ee23846ff0b456b3a8cbec5e'||session.healthVerified!==true)throw Error('reviewed read-only scope not ready');
const packet=fs.readFileSync(proposal.packetFile);if(packet.readUInt32LE()!==0x334d5958||sha256(packet)!==proposal.packetSha256||session.approvedHash!==proposal.packetSha256)throw Error('read-only packet identity mismatch');
const client=new MomentsClient(session),file=path.join(base,'read-only-trial.json');let state={at:new Date().toISOString(),proposalId:proposal.id,objectId:proposal.objectId,pid:session.pid,attempted:false,published:false};
if(fs.existsSync(file)){state=JSON.parse(fs.readFileSync(file,'utf8'));if(state.proposalId!==proposal.id||state.pid!==session.pid)throw Error('different prior read trial exists; inspect manually');}
const save=()=>fs.writeFileSync(file,JSON.stringify(state,null,2),{mode:0o600});
try{
  await client.health();
  if(!state.attempted){state.attempted=true;save();state.result=await client.submit(packet);save();}else state.result=await client.result();
  if(state.result.id!==proposal.requestId||state.result.state!=='server-accepted'||state.result.objectId!==proposal.objectId||state.result.taskCompleted!==true||state.result.taskDestroyed!==true)throw Error('read task completion not verified; no retry');
  const response=await client.object(),object=parseMomentsObject(Buffer.from(response.protobufHex,'hex'));
  const match=/<contentDesc>([\s\S]*?)<\/contentDesc>/u.exec(object.timeline),value=match?.[1];
  const plain=value?.startsWith('<![CDATA[')&&value.endsWith(']]>')?value.slice(9,-3):value?.replace(/&lt;|&gt;|&quot;|&apos;|&amp;/gu,s=>({'&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'",'&amp;':'&'}[s]));
  state.readback={idMatches:object.objectId===proposal.objectId,accountMatches:object.username===proposal.account,contentMatches:plain===original.text,timelineSha256:sha256(object.timeline)};state.callbackVerified=true;state.processStabilityVerified=false;save();
  console.log(JSON.stringify({result:state.result,readback:state.readback,published:false,stabilityCheckStillRequired:true}));
}catch(e){state.error=String(e.message).slice(0,200);save();console.error(state.error);process.exitCode=1;}
