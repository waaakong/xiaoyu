// Admin-only finite acceptance helper. No DLL loading and no paid synthesis.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {root} from './config.js';
import {WeChatVoiceClient,voicePacket,findVoiceReceipt} from './wechat-voice.js';
import {receiptBaseline,serverMessageId} from './wechat-receipts.js';
export async function wechatVoiceTrial(manager,body){
  const directory=path.join(root,'data','breeze-voice-implementation'),read=p=>JSON.parse(fs.readFileSync(p,'utf8')),proposal=read(path.join(directory,'native-trial-proposal.json')),session=read(path.join(root,'data','wechat-native-research','voice-session.json'));
  if(body.confirm!==true||body.dllSha256!==proposal.dllSha256||body.audioSha256!==proposal.sha256||session.dllSha256!==proposal.dllSha256||proposal.peer!=='filehelper'||proposal.milliseconds!==1000||proposal.account!==manager.config.account)throw Error('有限语音验收材料或账号不匹配');
  const file=path.join(root,'data','wechat-native-research','voice-outgoing',proposal.basename),audio=fs.readFileSync(file);if(createHash('sha256').update(audio).digest('hex')!==proposal.sha256||createHash('sha256').update(fs.readFileSync(session.dllPath)).digest('hex')!==proposal.dllSha256)throw Error('语音或DLL文件已改变');
  const auditFile=path.join(directory,'native-trial-result.json');if(fs.existsSync(auditFile))throw Error('本次语音验收已有记录，禁止重复发送');if(manager.selfTestBusy)throw Error('微信自测正在进行');
  const io=manager.child?.onebot;if(!io?.connected)throw Error('微信需先连接');await io.verify({checkControls:false});const client=new WeChatVoiceClient(session),health=await client.health();if(health.limit!==1||health.submissions!==0)throw Error('组件不在未提交的单次验收状态');
  const contacts=(await io.reader('/api/v1/contacts?keyword=filehelper&limit=500')).contacts?.filter(c=>c.username==='filehelper');if(contacts?.length!==1)throw Error('文件传输助手不唯一');
  manager.selfTestBusy=true;let claimed=false;
  const result={id:proposal.id,peer:'filehelper',account:proposal.account,dllSha256:proposal.dllSha256,audioSha256:proposal.sha256,milliseconds:1000,at:Date.now(),state:'not-submitted'};
  const fresh=()=>{if(manager.config.account!==proposal.account||manager.child?.onebot!==io||!io.connected||io.config().mode!=='hook')throw Error('微信账号或连接已改变');};
  try{return await manager.backend.withSelfReaderChat(contacts[0].conversationId,async()=>{
    const baseline=receiptBaseline(await io.messages('filehelper'));fresh();fs.writeFileSync(auditFile,JSON.stringify({...result,state:'dispatching'}),{flag:'wx',mode:0o600});claimed=true;
    await client.submit(voicePacket({...proposal,bytes:audio.length}),{beforeSend:fresh});
    for(let deadline=Date.now()+18000;Date.now()<deadline;){fresh();const match=findVoiceReceipt(await io.messages('filehelper'),{baseline,milliseconds:1000,started:result.at});if(match){Object.assign(result,{state:'server-confirmed',serverId:serverMessageId(match.serverId),finishedAt:Date.now(),voiceBubbleVerified:false});fs.writeFileSync(auditFile,JSON.stringify(result,null,2),{mode:0o600});return result;}await new Promise(r=>setTimeout(r,200));}
    throw Error('语音投递结果未知，不重发');
  });}catch(e){if(claimed)fs.writeFileSync(auditFile,JSON.stringify({...result,state:'unknown',finishedAt:Date.now()}),{mode:0o600});throw e;}finally{manager.selfTestBusy=false;}
}
