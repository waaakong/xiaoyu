// A single explicit, admin-authorized replay of a prepared acceptance fixture.
// The approved proposal owns the target and audio hash; no TTS or model calls.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {wavInfo} from './voice-audio.js';
import {policyFor} from './config.js';
export async function replayVoiceTrial(runtime,body){
  if(body.confirm!==true)throw Error('请确认这一次既有语音重发验收');
  const platform=runtime.platform??'qq',dataDir=platform==='wechat'?runtime.manager.dataDir:runtime.dataDir,directory=path.join(dataDir,'breeze-voice-implementation'),read=name=>JSON.parse(fs.readFileSync(path.join(directory,name),'utf8')),p=read(platform+'-replay-proposal.json'),backup=read('paid-chat-trial-backup.json'),match=(platform==='qq'?/^qq:(\d{5,18}):private:(\d{5,18})$/:/^wechat:([-A-Za-z0-9_]+):private:([-A-Za-z0-9_]+)$/).exec(p.scope??'');
  if(!match||p.scope!==backup[platform]?.scope||body.id!==p.id||body.sha256!==p.sha256||p.sourceSynthesisCalls!==1||p.additionalSynthesisCalls!==0)throw Error('既有语音验收材料不匹配');
  const file=path.join(directory,platform==='qq'?'qq-padded-tts.wav':'wechat-original-tts.wav'),bytes=fs.readFileSync(file);wavInfo(bytes);if(createHash('sha256').update(bytes).digest('hex')!==p.sha256)throw Error('既有语音文件已改变');
  const fresh=()=>{if(String(runtime.accountId)!==match[1]||!runtime.onebot?.connected||!policyFor(runtime.configuration(),p.scope).enabled)throw Error('测试聊天身份、目标或连接已改变');};
  fresh();const audit=path.join(directory,platform+'-replay-result.json'),result={id:p.id,scope:p.scope,audioSha256:p.sha256,synthesisCalls:0,at:new Date().toISOString(),state:'dispatching'};
  fs.writeFileSync(audit,JSON.stringify(result),{flag:'wx',mode:0o600});
  const oldMode=policyFor(runtime.configuration(),p.scope).voiceMode;try{if(platform==='wechat')runtime.saveChat(p.scope,{voiceMode:'requested'});const receipt=await runtime.onebot.record({message_type:'private',self_id:platform==='qq'?Number(match[1]):match[1],user_id:platform==='qq'?Number(match[2]):match[2]},file,{beforeSend:fresh});if(!receipt?.message_id)throw Error('语音回执未知，不自动重发');const row=runtime.store.add(p.scope,'assistant',platform==='qq'?'[语音尾字修复验收，同一次合成]':'[微信语音验收，复用已合成音频]','delivered','系统测试');runtime.store.setSource(row,String(receipt.message_id));runtime.store.setReceipts(row,[receipt]);Object.assign(result,{state:'confirmed',messageId:String(receipt.message_id),finishedAt:new Date().toISOString()});fs.writeFileSync(audit,JSON.stringify(result,null,2));return result;
  }catch(e){fs.writeFileSync(audit,JSON.stringify({...result,state:'unknown',finishedAt:new Date().toISOString()}));throw e;}finally{if(platform==='wechat')runtime.saveChat(p.scope,{voiceMode:oldMode});}
}
