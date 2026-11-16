import {createHash} from 'node:crypto';
import {emotionTone} from './voice-emotion.js';
import {energyAt} from './life.js';

export const SOCIAL_EXPRESSION=`### 日常表达与分寸
普通闲聊用具体口语，不用标题、加粗、编号、列表、“综上”或说明书式总结。不固定开场、解释、追问三件套；一句够就一句，允许长短不同、自然停顿和少量语气词，不故意造错别字、口误或漏答重要问题。先回应眼前最有关的一件事，需要展开时等对方追问，不把后文排成后台补发任务。
按人格原有喜恶表达自己的看法，不万能、不迎合，不懂就说不太了解；不为了扮演短板而装不知道。不喜欢的话题可以委婉说不太想聊，不用无声漏掉重要请求。不把“我现在感觉”“我接下来要”等内部状态播报当作日常开场，不展示情绪标签或内心旁白。心情通过用词、长短、轻重与停顿表现，不要求对方负责。
旧记忆只在当前话题相关时自然提到，不逐条背档案；陈旧细节拿不准就说记不清或询问，不随机改错生日、身份、约定和重要事实。不得伪造经历、现实活动或已完成的操作。
表情可以与克制的文字有细微反差，但不在安慰或认真求助时乱发表情。复杂任务、查资料、代码、来源链接及对方明确要求的格式仍准确完整，不能为了像人而随机漏答。直接被问及真实身份或能力时如实回答。`;

export function styleSample(key){return createHash('sha256').update(String(key)).digest().readUInt32BE(0)/0x100000000;}
export function expressionEmotion(state,life,{now=Date.now(),key='',text=''}={}){
 if(!state?.enabled||state.expressionStyle==='off')return state;
 const axes={...state.axes};if(life?.enabled){const rhythm=energyAt(life,now);axes.energy=Math.min(state.axes?.energy??.7,rhythm.energy+.02);}
 if(key&&!isTask(text)&&Math.abs(state.valence??0)<.12&&(axes.interest??.2)<.25&&styleSample(key+':interest')>.96)axes.interest=.1;
 return {...state,axes};
}
export const isTask=text=>/```|\b(?:json|sql|python|javascript)\b|(?:联网|搜索|查(?:一下|资料|询)|来源|链接|代码|教程|步骤|清单|表格|列出|逐条|详细|完整|总结|分析|计算|翻译|解释|方案|对比|修复|配置|报错|怎么(?:做|用|弄|办)|帮我|请帮|求助|怎么办|紧急|救命|撑不住|活不下去|想自杀|想死|只回复|只说|原样|分成|分段|两段)/iu.test(text);
export function socialProfile({text='',state={},key='',enabled=true}={}){
 const task=isTask(text);
 if(!enabled)return {enabled:false,mode:task?'task':'casual',bubbles:3,prompt:''};
 const tone=emotionTone(state),sample=styleSample(key),brief=['tired','annoyed','angry','hurt','low','bored'].includes(tone)||!['happy','excited'].includes(tone)&&sample<.65,bubbles=brief?1:sample<.9?2:3;
 const direction={tired:'精力偏低，简短温和，不刻意找新话题',annoyed:'略不耐，短句直接，别刻薄或迁怒',angry:'不悦但克制，只对具体事情表达立场',hurt:'有些委屈，收着说，不索取安慰',low:'安静一点，不敷衍认真求助',bored:'兴致不高，可以简短回应，不把对方的问题岔开',happy:'轻快一点，有合适的梗才调侃',excited:'有兴致，可自然延伸一个相关细节',comfort:'认真接住对方，少讲道理',serious:'认真直接，保留必要细节',neutral:'放松平常，不强行热情'}[tone]??'自然回应';
 const contrast=!task&&sample>.85&&sample<.95&&['neutral','happy','bored','tired'].includes(tone)&&!/难过|受伤|失恋|去世|病|压力|难受|讨厌|生气|求助|事故|怎么办/u.test(text);
 return {enabled:true,mode:task?'task':'casual',tone,contrast,bubbles:task?3:bubbles,prompt:'\n本轮表达状态（角色模拟，只影响表达，不改变事实和权限）：'+direction+'。'+(task?'当前是明确任务；准确完整、按需结构化，不随机省略要求。':`本轮倾向${brief?'短回应':'自然回应'}，最多${bubbles}个意群；不凑条数。`)+(sample>.92&&!task?'可以有一个与当前话题有关的小联想，先接住当前话题，不强行跳题。':'')+(sample<.1&&!task?'合适时可用一个自然语气词，不必硬加。':'')+'不要在正文说明这些状态。'};
}
export function socialReply(text,profile){
 if(!profile?.enabled||profile.mode!=='casual'||typeof text!=='string'||/```|https?:\/\//u.test(text))return text;
 return text.replace(/^\s*#{1,6}\s+/gmu,'').replace(/^\s*(?:[-*•]\s+|\d+[.)、]\s+)/gmu,'').replace(/\*\*([^*\n]+)\*\*/gu,'$1').replace(/^(?:综上所述|综上|总之)[，,：:]\s*/gmu,'').trim();
}
