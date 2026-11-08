import {validateScheduled} from './scheduled-tasks.js';
import {validateProactive} from './proactive.js';
import {parseScope} from './chat-identity.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {validatePluginCommands} from './plugin-gateway.js';
export const root = path.resolve(import.meta.dirname, '..');
export const chatDefaults={memeAutoCollect:false,memeBackground:false,scheduledTasks:{enabled:false,creators:[]},proactive:{enabled:false},quoteReplies:true,forwardSend:true,pokeSend:true,pokeResponse:false,pokeReturn:false,pokeCooldownSeconds:300,forwardRead:true,contextLinking:true,mergeQueued:true,rhythmMode:'fast',maxBubbles:2,groupMentionMode:'auto',mentionCooldownSeconds:600,speechInput:false,speechEmotion:true,speechWakeWord:false,personaId:'default',model:null,engine:null,wakeMode:'mention',keywordMatch:'contains',wakeWords:['小鱼','大肥鱼'],followupSeconds:60,naturalProbability:0.05,naturalCooldownSeconds:120,historyMessages:20,historyChars:14000,memoryChars:1600,images:true,stickers:true,stickerLibraryId:'',stickerMode:'atmosphere',stickerCooldownSeconds:30,stickerEdge:300,webSearch:false,autoSummary:true,crossMemoryRead:false,crossMemoryWrite:false,pluginsEnabled:false,pluginCommands:[]};
export function validateChat(c,partial=false){
  const allowed=new Set([...Object.keys(chatDefaults),'enabled','voiceMode','pluginMode','pluginCallLimit','allowedSenders']);
  if(!c||typeof c!=='object'||Array.isArray(c)||Object.keys(c).some(k=>!allowed.has(k)))throw new Error('聊天设置字段不合法');
  for(const k of ['memeAutoCollect','memeBackground','quoteReplies','forwardSend','pokeSend','pokeResponse','pokeReturn','forwardRead','enabled','images','stickers','webSearch','autoSummary','crossMemoryRead','crossMemoryWrite','pluginsEnabled','speechInput','speechEmotion','speechWakeWord'])if(c[k]!==undefined&&typeof c[k]!=='boolean')throw new Error(`${k} 必须为开关`);
  if(c.pokeCooldownSeconds!==undefined&&(!Number.isInteger(c.pokeCooldownSeconds)||c.pokeCooldownSeconds<30||c.pokeCooldownSeconds>3600))throw Error('拍一拍冷却范围30—3600秒');
  if(c.rhythmMode!==undefined&&!['instant','fast','social'].includes(c.rhythmMode))throw Error('聊天节奏无效');
  if(c.maxBubbles!==undefined&&![1,2,3].includes(c.maxBubbles))throw Error('分条上限为1—3');
  if(c.scheduledTasks!==undefined)validateScheduled(c.scheduledTasks);
  if(c.proactive!==undefined)validateProactive(c.proactive);
  if(c.pluginCommands!==undefined)validatePluginCommands(c.pluginCommands);
  for(const k of ['contextLinking','mergeQueued'])if(c[k]!==undefined&&typeof c[k]!=='boolean')throw Error('上下文设置必须为开关');
  if(c.groupMentionMode!==undefined&&!['off','auto','always'].includes(c.groupMentionMode))throw Error('群聊@模式无效');
  if(c.mentionCooldownSeconds!==undefined&&(!Number.isInteger(c.mentionCooldownSeconds)||c.mentionCooldownSeconds<0||c.mentionCooldownSeconds>3600))throw Error('@冷却范围0—3600秒');
  if(c.allowedSenders!==undefined&&(!Array.isArray(c.allowedSenders)||c.allowedSenders.length>64||c.allowedSenders.some(id=>typeof id!=='string'||!/^[-@.A-Za-z0-9_]{1,128}$/.test(id))||new Set(c.allowedSenders).size!==c.allowedSenders.length))throw Error('允许发言者编号无效');
  if(c.pluginMode!==undefined&&!['commands','enhanced'].includes(c.pluginMode))throw new Error('插件模式无效');
  if(c.pluginCallLimit!==undefined&&(!Number.isInteger(c.pluginCallLimit)||c.pluginCallLimit<1||c.pluginCallLimit>6))throw new Error('插件模型调用上限范围1—6次');
  if(c.voiceMode!==undefined&&!['off','requested','always','only'].includes(c.voiceMode))throw new Error('语音模式无效');
  if(c.personaId!==undefined&&(typeof c.personaId!=='string'||!/^[-\w]{1,64}$/.test(c.personaId)))throw new Error('人格编号无效');
  if(c.engine!==undefined&&c.engine!==null&&!['codex','dsh'].includes(c.engine))throw Error('模型引擎无效');
  if(c.model!==undefined&&c.model!==null&&(typeof c.model!=='string'||c.model.length>120))throw new Error('模型名称无效');
  for(const [k,values] of [['wakeMode',['mention','hybrid']],['keywordMatch',['prefix','contains']],['stickerMode',['requested','atmosphere','active','always']],['stickerEdge',[0,200,300,400,450]]])if(c[k]!==undefined&&!values.includes(c[k]))throw new Error(`${k} 无效`);
  if(c.stickerLibraryId!==undefined&&(typeof c.stickerLibraryId!=='string'||c.stickerLibraryId&&!/^[-\w]{1,64}$/.test(c.stickerLibraryId)))throw new Error('图库编号无效');
  if(c.stickerCooldownSeconds!==undefined&&(!Number.isInteger(c.stickerCooldownSeconds)||c.stickerCooldownSeconds<0||c.stickerCooldownSeconds>3600))throw new Error('表情冷却范围0—3600秒');
  if(c.wakeWords!==undefined&&(!Array.isArray(c.wakeWords)||c.wakeWords.length>12||c.wakeWords.some(x=>typeof x!=='string'||!x.trim()||x.length>30)))throw new Error('唤醒词无效');
  for(const [k,min,max] of [['followupSeconds',0,300],['historyMessages',2,60],['historyChars',1000,40000],['memoryChars',200,4000],['naturalCooldownSeconds',30,3600]])if(c[k]!==undefined&&(!Number.isInteger(c[k])||c[k]<min||c[k]>max))throw new Error(`${k} 范围 ${min}—${max}`);
  if(c.naturalProbability!==undefined&&(typeof c.naturalProbability!=='number'||!Number.isFinite(c.naturalProbability)||c.naturalProbability<0||c.naturalProbability>0.25))throw new Error('自然接话概率范围 0—0.25');
  return partial?c:{...chatDefaults,...c};
}
export function policyFor(config,scope){
  const who=parseScope(scope);if(who.member)throw Error('会话编号无效');const match=[null,who.account,who.kind,who.peer];if(config.platform&&who.platform!==config.platform||!config.platform&&who.platform!=='qq')throw Error('不允许跨平台访问');
  const defaultEnabled=(match[2]==='private'?config.allowedUsers:config.allowedGroups).includes(match[3]);
  const base={voiceMode:'off',pluginMode:'commands',pluginCallLimit:3,...chatDefaults,wakeWords:config.wakeWords,followupSeconds:config.followupSeconds,historyMessages:config.historyMessages,memoryChars:config.memoryChars,model:config.model??null,...config.defaults,enabled:defaultEnabled};
  const own=config.chats?.[scope],engine=own?.model&&!Object.hasOwn(own,'engine')?'codex':own?.engine??base.engine;
  // Inheriting a model is only valid inside the same engine. A chat selecting
  // DSH over a Codex platform default must use DSH's own default, and vice versa.
  return {...base,...own,engine,model:own?.model??((engine??'codex')===(base.engine??'codex')?base.model:null)};
}
export function stripLegacyWeb(policy){return Object.fromEntries(Object.entries(policy??{}).filter(([k])=>!['webFetch','webProvider','douyinRead'].includes(k)));}
export function loadConfig(file = path.join(root, 'config.json')) {
  const c = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!/^.{24,}$/.test(c.onebotToken ?? '')) throw new Error('请先运行 npm run setup 生成强令牌');
  for (const k of ['allowedUsers', 'allowedGroups', 'admins']) {
    if (!Array.isArray(c[k]) || c[k].some(x => typeof x !== 'string' || !(c.platform==='wechat'?/^[-\w@.]{1,160}$/:/^\d+$/).test(x))) throw new Error(`${k} 必须为 QQ 号码字符串数组`);
  }
  if (!Array.isArray(c.wakeWords) || !c.wakeWords.length || c.wakeWords.some(x => typeof x !== 'string' || !x.trim())) throw new Error('wakeWords 不能为空');
  for (const [key, min, max] of [['port',1024,65535],['followupSeconds',0,300],['historyMessages',2,30],['memoryChars',200,4000],['timeoutSeconds',10,300]]) {
    if (!Number.isInteger(c[key]) || c[key] < min || c[key] > max) throw new Error(`${key} 范围 ${min}—${max}`);
  }
  if (typeof c.codexPath !== 'string' || !c.codexPath.trim()) throw new Error('codexPath 缺失');
  if(c.defaults)c.defaults=validateChat(stripLegacyWeb(c.defaults),true);
  if(c.chats){if(typeof c.chats!=='object'||Array.isArray(c.chats)||Object.keys(c.chats).length>2000)throw new Error('聊天配置无效');for(const [k,v]of Object.entries(c.chats)){if(parseScope(k).platform!==(c.platform??'qq')||parseScope(k).member)throw Error('会话编号无效');c.chats[k]=validateChat(stripLegacyWeb(v),true);}}
  return {...c, connectionMode:'local', dataDir:path.join(root,'data'), codexHome:process.env.CODEX_HOME||path.join(os.homedir(),'.codex'), workspace:path.join(root,'data','chat-workspace')};
}
