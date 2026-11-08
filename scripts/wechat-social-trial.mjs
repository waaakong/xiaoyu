// Execute only after explicit approval of the concrete DLL and these three sends.
// No retry, no promotion and no automatic chat authorization are performed.
import fs from 'node:fs';import path from 'node:path';import {randomUUID,createHash} from 'node:crypto';
import {WeChatManager} from '../src/wechat-runtime.js';import {WeChatIO} from '../src/wechat-io.js';
import {root,loadConfig} from '../src/config.js';import {WeChatSocialClient,quoteXml,forwardedXml,socialPacket} from '../src/wechat-social.js';import {serverMessageId} from '../src/wechat-receipts.js';
const expected=process.argv[process.argv.indexOf('--confirm-sha256')+1];if(!process.argv.includes('--execute')||!/^[a-f0-9]{64}$/.test(expected??''))throw Error('Requires explicit --execute and reviewed --confirm-sha256');
const directory=path.join(root,'data','wechat-social-research'),manifest=JSON.parse(fs.readFileSync(path.join(directory,'build/manifest.json'),'utf8')),session=JSON.parse(fs.readFileSync(path.join(directory,'session.json'),'utf8')),journal=path.join(directory,'finite-trial.json');
if(fs.existsSync(journal))throw Error('A trial journal already exists; inspect results before any further send.');
if(manifest.dllSha256!==expected||session.dllSha256!==expected||!session.healthVerified||createHash('sha256').update(fs.readFileSync(session.dllPath)).digest('hex')!==expected)throw Error('Reviewed loaded DLL identity mismatch');
const c=JSON.parse(fs.readFileSync(path.join(root,'data','wechat-connection.json'),'utf8'));
const approvedScope = {
  account: process.env.XIAOYU_TRIAL_ACCOUNT,
  group: process.env.XIAOYU_TRIAL_GROUP,
  member: process.env.XIAOYU_TRIAL_MEMBER
};
if (!approvedScope.account || !approvedScope.group || !approvedScope.member ||
    c.account !== approvedScope.account || session.patGroup !== approvedScope.group ||
    session.patMember !== approvedScope.member) throw Error('Finite test scope mismatch; supply explicit XIAOYU_TRIAL_ACCOUNT, GROUP and MEMBER');

const client=new WeChatSocialClient(session),manager=new WeChatManager({dataDir:path.join(root,'data'),configuration:loadConfig}),io=new WeChatIO({config:()=>c,policy:()=>({enabled:false}),root,dir:path.join(root,'data')});
const result={at:new Date().toISOString(),dllSha256:expected,scope:{cards:'filehelper',pokeGroup:session.patGroup,pokeMember:session.patMember},attempts:[],completed:false,clientVerificationPending:true,c8Replaced:false};
const save=()=>fs.writeFileSync(journal,JSON.stringify(result,null,2),{mode:0o600});
try{
  const health=await client.health();if(health.submissions!==0||health.limit!==3)throw Error('Finite DLL session is not fresh; no send performed');
  const contacts=(await io.reader('/api/v1/contacts?keyword=filehelper&limit=100')).contacts??[],matches=contacts.filter(m=>m.username==='filehelper');if(matches.length!==1)throw Error('No unique filehelper source mapping');
  const wanted=['小鱼社交验收源A-1106','小鱼社交验收源B-1106'];
  const rows=await manager.backend.withSelfReaderChat(matches[0].conversationId,()=>io.messages('filehelper'));
  const sources=wanted.map(text=>{const found=rows.filter(m=>m.isSend&&Number(m.localType??m.type)===1&&(m.text??m.content)===text&&serverMessageId(m.serverId)&&Number(m.createTime)*1000>Date.now()-3600000);if(found.length!==1)throw Error('Need one fresh real filehelper source: '+text);const m=found[0];return {sender:c.account,name:m.senderDisplayName??m.senderDisplay??m.senderName??c.account,serverId:serverMessageId(m.serverId),text:m.text??m.content,time:m.createTime};});
  result.sourceIds=sources.map(m=>m.serverId);save();
  const actions=[{name:'quote',kind:1,peer:'filehelper',payload:quoteXml({peer:'filehelper',text:'微信原生引用验收',source:sources[0]})},{name:'forward',kind:2,peer:'filehelper',payload:forwardedXml({title:'微信原生合并记录验收',messages:sources})},{name:'poke',kind:3,peer:session.patGroup,target:session.patMember}];
  for(const action of actions){const requestId=randomUUID(),entry={kind:action.name,requestId,peer:action.peer,state:'attempting',at:Date.now()};result.attempts.push(entry);save();try{const receipt=await client.submit(socialPacket({...action,requestId}));entry.state='server-accepted';entry.receipt=receipt;save();}catch(e){entry.state=e.deliveryAttempted===false?'not-submitted':'unknown-or-rejected';entry.error=String(e.message).slice(0,200);if(e.result)entry.nativeResult=e.result;save();throw e;}}
  result.completed=true;save();console.log(JSON.stringify({completed:true,serverReceipts:result.attempts.map(x=>({kind:x.kind,serverId:x.receipt.message_id})),clientVerificationPending:true,c8Replaced:false}));
}finally{io.foreground.close();await manager.accessibility.close();}
