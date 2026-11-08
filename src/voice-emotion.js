const schema='xiaoyu.breeze-emotion-template/v1';
const tones=['neutral','happy','excited','low','serious','comfort','tired'];
const placeholders=new Set(['emotion_direction','intensity_direction','pace_direction','pause_direction','distance_direction']);
const zh={neutral:['平和放松地说','语速自然','按语义自然停顿'],happy:['语气温暖，带一点轻快的笑意','比平时略轻快','短句之间自然停顿'],excited:['带着清晰的欣喜，保持克制','轻快但不抢词','重点前稍作停顿'],low:['语气安静柔和，情绪收着表达','比平时略慢','句间停顿稍长，不拖尾'],serious:['语气认真克制，不咄咄逼人','语速稳定','短句停顿清楚'],comfort:['像在认真安慰熟悉的人，温和而笃定','平稳稍慢','给对方留出呼吸感'],tired:['声音放松，表达简洁，不故意虚弱','舒缓但保持清晰','自然停顿']};
const en={neutral:['Speak calmly and naturally','use a natural pace','pause at meaning boundaries'],happy:['Sound warm with a light smile','speak slightly more brightly','leave natural gaps between phrases'],excited:['Express clear but restrained delight','be lively without rushing','briefly pause before key phrases'],low:['Sound quiet and gentle with restrained sadness','speak slightly slower','allow longer pauses without trailing off'],serious:['Sound serious and composed without hostility','keep an even pace','make short phrases clear'],comfort:['Reassure a familiar listener warmly and steadily','speak calmly and slightly slower','allow breathing room'],tired:['Sound relaxed and concise without acting weak','speak gently and clearly','pause naturally']};
export const voiceTemplates=['zh','en'].map(language=>({schema,id:'natural-companion-'+language,name:language==='zh'?'自然陪伴 · 中文':'Natural companion · English',language,template:language==='zh'?'保持所选音色的声音身份。{{emotion_direction}}，{{intensity_direction}}；{{pace_direction}}，{{pause_direction}}。{{distance_direction}}，自然口语表达。':'Keep the selected voice identity. {{emotion_direction}}, {{intensity_direction}}; {{pace_direction}} and {{pause_direction}}. {{distance_direction}}.',distance:language==='zh'?'像和熟悉的人面对面聊天':'Sound like a face-to-face conversation with someone familiar',mapping:Object.fromEntries(Object.entries(language==='zh'?zh:en).map(([key,v])=>[key,{emotion:v[0],pace:v[1],pause:v[2]}]))}));
const plain=x=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.getPrototypeOf(x)===Object.prototype;
const exact=(x,keys)=>plain(x)&&Object.keys(x).every(k=>keys.includes(k));
function safe(value,max){return typeof value==='string'&&value.trim()&&value.length<=max&&!/[\x00-\x08\x0b\x0c\x0e-\x1f]|https?:\/\/|(?:[A-Za-z]:\\)|\$\{|<script/iu.test(value);}
export function validateVoiceTemplate(value){
  if(!exact(value,['schema','id','name','language','template','distance','mapping'])||value.schema!==schema||!/^[-a-z0-9]{1,60}$/.test(value.id??'')||!safe(value.name,80)||!['zh','en'].includes(value.language)||!safe(value.template,500)||!safe(value.distance,120)||!exact(value.mapping,tones)||tones.some(t=>!exact(value.mapping[t],['emotion','pace','pause'])||['emotion','pace','pause'].some(k=>!safe(value.mapping[t][k],120)||/[{}]/.test(value.mapping[t][k]))))throw Error('情绪模板字段无效或映射不完整');
  const found=[...value.template.matchAll(/{{([^{}]+)}}/g)].map(m=>m[1]);
  if(!found.length||found.some(k=>!placeholders.has(k))||/[{}]/.test(value.template.replace(/{{[^{}]+}}/g,'')))throw Error('情绪模板含未知或不完整的占位符');
  if(/[{}]/.test(value.distance))throw Error('距离描述不能包含占位符');
  return structuredClone(value);
}
export function emotionTone(state={}){
  if(state.enabled===false||state.expressionStyle==='off'||/不确定/.test(state.lastCue??''))return 'neutral';
  const valence=Number.isFinite(state.valence)?Math.max(-1,Math.min(1,state.valence)):0,arousal=Number.isFinite(state.arousal)?Math.max(0,Math.min(1,state.arousal)):.2;
  if(state.axes?.worry>.6)return 'comfort';
  if(state.axes?.energy<.3&&Math.abs(valence)<.3)return 'tired';
  return valence>.3?(arousal>.55?'excited':'happy'):valence>.1?'happy':valence<-.4&&arousal>.55?'serious':valence<-.12?'low':'neutral';
}
export function compileVoiceDirection(template,state={},style=''){
  const t=validateVoiceTemplate(template),tone=emotionTone(state),row=t.mapping[tone],en=t.language==='en';
  const strength=state.expressionStyle==='explicit'&&Math.abs(state.valence??0)>.5?'moderate':'subtle';
  const fields={emotion_direction:row.emotion,intensity_direction:en?(strength==='moderate'?'make the emotion clear but not theatrical':'keep the emotion subtle and unexaggerated'):(strength==='moderate'?'情绪明确但不过度表演':'只带轻微情绪，不夸张'),pace_direction:row.pace,pause_direction:row.pause,distance_direction:t.distance};
  const instructions=t.template.replace(/{{([^{}]+)}}/g,(_,key)=>fields[key])+(style?(en?' Delivery preference: ':' 表达偏好：')+style:'');
  if(instructions.length>1000)throw Error('编译后的表演指令超过1000字符');
  return {instructions,tone,templateId:t.id,language:t.language,strength};
}
