// Only short, unformatted single-newline utterances (or short blank-line
// paragraphs) are eligible. Source links, code and structured answers retain
// their existing single-message presentation.
const HTML_TAG=/<\/?[a-z][^<>\n]*>/iu;
const STRUCTURED=/https?:\/\/|www\.|->|[`#*|{}\[\]]/u;
const HAN=/\p{Script=Han}/u;
// A short kaomoji or sticker line may legitimately contain no Han character.
// Keep the Han requirement for prose, but let these small expressive lines
// become their own bubble instead of disqualifying the whole reply.
const SHORT_EXPRESSIVE=s=>Array.from(s).length<=24&&/[^\x00-\x7F]/u.test(s)&&!STRUCTURED.test(s);
// WeChat face tokens such as [偷笑] are plain text, not markup; ignore them
// when deciding whether a reply looks "formatted".
const FACE=/\[[\p{Script=Han}A-Za-z0-9，。！？、~～…：:]{1,12}\]/gu;
export function chatParts(text,{maxParts=3}={}){
  if(typeof text!=='string')return [text];
  const body=text.replace(/\r\n?/g,'\n').trim();
  if(!body.includes('\n')||Array.from(body).length>160||!HAN.test(body)||STRUCTURED.test(body.replace(FACE,''))||HTML_TAG.test(body))return [text];
  const parts=body.split(/\n[ \t]*\n|\n/).map(s=>s.trim());
  if(parts.length<2||parts.some(s=>!s||(!HAN.test(s)&&!SHORT_EXPRESSIVE(s))||Array.from(s).length>80||/[=]/u.test(s)||/^(?:[-+•]|\d+[.)、])\s*/u.test(s)))return [text];
  const limit=[1,2,3].includes(maxParts)?maxParts:3;
  // More utterances than the bubble budget are merged into the last bubble
  // instead of falling back to one long message.
  return parts.length>limit?[...parts.slice(0,limit-1),parts.slice(limit-1).join('\n')]:parts;
}

// DSH natural text commonly uses blank paragraph separators. Collapse them to
// single newlines when the reply still passes the short-utterance guards, so
// the bubble splitter can see each utterance as one line.
export function naturalChatText(text){
  if(typeof text!=='string')return text;
  const candidate=text.replace(/\r\n?/g,'\n').replace(/\n(?:[ \t]*\n)+/g,'\n');
  return candidate!==text&&chatParts(candidate).length>1?candidate:text;
}

// Models sometimes stage an expression or gesture in brackets on its own line.
// That is direction for the actor, not something to type at the contact; left in,
// it also disqualifies the reply from the short-utterance bubble split.
const NARRATION=/^\s*[\[【]\s*([^\[\]【】\r\n]{1,60})\s*[\]】]\s*$/u;
const TAG=/^(?:REPLY_TO|表情|图片|语音|视频|文件|链接|位置|引用|合并转发|社交动作|系统|转发|附件)\s*[:：]/u;
export function stripNarration(text){
  if(typeof text!=='string'||!(text.includes('[')||text.includes('【')))return text;
  const kept=text.split('\n').filter(line=>{const match=NARRATION.exec(line);return !match||TAG.test(match[1]);});
  const cleaned=kept.join('\n').trim();
  return cleaned||text;
}

export const CHAT_RHYTHM='日常闲聊先给一个具体反应，说到意思够了就停；需要补充时再给原因、转折或细节，不固定开场—分析—追问。短回应大多不用空格、句末句号或笑声；双空格只偶尔用于确有停顿的一条消息内部，不把每条都写成前半句加双空格加后半句。reply 里每行一个意群，只用单个换行分开；一次最多三个意群，超过三个就把多出来的并进最后一行，不用空行分段或列点凑条数，空行不会多分一条。一句够了就一句，不固定连发，不把一个词或普通主谓短句切碎，不用整行括号写动作、表情或内心旁白（这类括号行会被程序当旁白丢弃）。每轮至多三个日常意群，不靠重复语气词、波浪号或无意义追问补满。复杂解释、代码、数学、来源链接和用户指定格式正常保留结构与标点，不受日常短话限制。不要为了像真人而故意出错或虚构现实活动；停顿由程序控制，不在回复里演示思考过程。';
