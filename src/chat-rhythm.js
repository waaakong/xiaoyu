// Only short, unformatted single-newline utterances are eligible. Paragraphs,
// source links and structured answers retain their existing presentation.
export function chatParts(text,{maxParts=3}={}){
  if(typeof text!=='string')return [text];
  if(!text.includes('\n')||text.includes('\r')||/\n\s*\n/u.test(text)||Array.from(text).length>160||/https?:\/\/|www\.|[`#*|<>{}\[\]]/u.test(text))return [text];
  const parts=text.split('\n').map(s=>s.trim());
  if(parts.length<2||parts.length>3||parts.some(s=>!s||!/\p{Script=Han}/u.test(s)||Array.from(s).length>80||/[=]/u.test(s)||/^(?:[-+•]|\d+[.)、])\s*/u.test(s)))return [text];
  const limit=[1,2,3].includes(maxParts)?maxParts:3;return parts.length>limit?[...parts.slice(0,limit-1),parts.slice(limit-1).join('\n')]:parts;
}

// DSH natural text commonly uses blank paragraph separators. Normalize only
// replies which still pass the same conservative short-utterance guards.
export function naturalChatText(text){
  if(typeof text!=='string')return text;
  const candidate=text.replace(/\r\n?/g,'\n').replace(/\n(?:[ \t]*\n)+/g,'\n');
  return candidate!==text&&chatParts(candidate).length>1?candidate:text;
}

export const CHAT_RHYTHM='日常闲聊先给一个具体反应，说到意思够了就停；需要补充时再给原因、转折或细节，不固定开场—分析—追问。短回应大多不用空格、句末句号或笑声；双空格只偶尔用于确有停顿的一条消息内部，不把每条都写成前半句加双空格加后半句。确有两个或三个独立短意群时，reply可用单个换行分开，程序会在适合时分条投递；一句够了就一句，不固定连发，不把一个词或普通主谓短句切碎。每轮至多三个日常意群，不靠重复语气词、波浪号或无意义追问补满。复杂解释、代码、数学、来源链接和用户指定格式正常保留结构与标点，不受日常短话限制。不要为了像真人而故意出错、虚构现实活动或拖延。';
