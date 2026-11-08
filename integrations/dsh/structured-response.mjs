import {validMemeInsights} from '../../src/meme-analysis.js';
const fail=code=>Object.assign(Error(code),{code});
export function structuredResponse(raw){
  if(typeof raw!=='string'||raw.length>48000)throw fail('DSH_RESPONSE_LIMIT');
  const text=raw.trim().replace(/^```(?:json)?\s*|\s*```$/gi,'');let value;
  try{value=JSON.parse(text);}catch{
    const objects=[];let start=-1,depth=0,string=false,escape=false;
    for(let i=0;i<text.length;i++){
      const c=text[i];if(start<0){if(c==='{'){start=i;depth=1;}continue;}
      if(string){if(escape)escape=false;else if(c==='\\')escape=true;else if(c==='"')string=false;continue;}
      if(c==='"')string=true;else if(c==='{')depth++;else if(c==='}'&&!--depth){objects.push(text.slice(start,i+1));start=-1;}
    }
    if(objects.length!==1||depth)throw fail(objects.length>1?'DSH_RESPONSE_AMBIGUOUS':'DSH_RESPONSE_JSON_INVALID');
    try{value=JSON.parse(objects[0]);}catch{throw fail('DSH_RESPONSE_JSON_INVALID');}
  }
  if(!value||typeof value!=='object'||Array.isArray(value)||typeof value.reply!=='string'||!Array.isArray(value.memories)||value.reply.length>24000)throw fail('DSH_RESPONSE_SCHEMA_INVALID');
  return value;
}

// Escape literal control characters only inside JSON strings. This preserves
// the generated text; it never invents missing quotes, fields or braces.
function escapedControls(text){
  let out='',quoted=false,escape=false;
  for(const c of text){if(quoted){if(escape){out+=c;escape=false;continue;}if(c==='\\'){out+=c;escape=true;continue;}if(c==='"')quoted=false;
    if(c.charCodeAt(0)<32){out+='\\u'+c.charCodeAt(0).toString(16).padStart(4,'0');continue;}
  }else if(c==='"')quoted=true;out+=c;}return out;
}

function complete(reply,metadata={},mode='text',warnings=[]){
  if(typeof reply!=='string'||!reply.trim()||reply.length>24000)throw fail('DSH_RESPONSE_REPLY_INVALID');
  const memories=Array.isArray(metadata?.memories)?metadata.memories:[];
  if(metadata?.memories!==undefined&&!Array.isArray(metadata.memories))warnings.push('DSH_MEMORY_FORMAT_IGNORED');
  return {...(metadata?.memeInsights!==undefined?{memeInsights:validMemeInsights(metadata.memeInsights)}:{}),reply:reply.trim(),memories,assetId:typeof metadata?.assetId==='string'?metadata.assetId:null,format:{mode,warnings}};
}

export function chatResponse(raw){
  if(typeof raw!=='string'||raw.length>48000)throw fail('DSH_RESPONSE_LIMIT');
  const value=raw.trim();
  // Optional metadata is separate from human-facing text, and never sent.
  const marker=/(?:^|\n)```xiaoyu-meta[ \t]*(?:\r?\n|$)/.exec(value);
  if(marker){
    const reply=value.slice(0,marker.index),tail=value.slice(marker.index+marker[0].length);
    try{if(!/\n```\s*$/.test(tail)||tail.includes('```xiaoyu-meta'))throw Error();const metadata=JSON.parse(tail.replace(/\n```\s*$/,''));if(!metadata||typeof metadata!=='object'||Array.isArray(metadata))throw Error();return complete(reply,metadata,'text-metadata');}
    catch{return complete(reply,{},'text',['DSH_METADATA_FORMAT_IGNORED']);}
  }
  // Accept the previous envelope while conversations/models transition.
  const unfenced=value.replace(/^```(?:json)?\s*|\s*```$/gi,'');
  let parsed;try{parsed=JSON.parse(unfenced);}catch{}
  if(parsed&&typeof parsed==='object'&&!Array.isArray(parsed)&&typeof parsed.reply==='string')return complete(parsed.reply,parsed,'legacy-json');
  try{const parsed=structuredResponse(value);return complete(parsed.reply,parsed,'legacy-json');}catch(error){
    if(error.code==='DSH_RESPONSE_AMBIGUOUS')throw error;
    // A malformed envelope must not leak its internal fields into the chat.
    if(/\{[\s\S]*"(?:reply|memories|assetId|memeInsights)"\s*:/.test(unfenced)){
      try{const parsed=JSON.parse(escapedControls(unfenced));if(typeof parsed?.reply==='string')return complete(parsed.reply,parsed,'legacy-json',['DSH_JSON_CONTROL_ESCAPED']);}catch{}
      throw fail('DSH_RESPONSE_JSON_INVALID');
    }
    return complete(value,{},'text');
  }
}

// Local machine tasks are not human chat envelopes. Keep their JSON opaque
// to the natural reply/metadata parser; the owning task validates its fields.
export function structuredTaskResponse(raw){
  if(typeof raw!=='string'||raw.length>24000)throw fail('DSH_TASK_RESPONSE_LIMIT');
  let value;try{value=JSON.parse(raw.trim().replace(/^```(?:json)?\s*|\s*```$/gi,''));}catch{throw fail('DSH_TASK_JSON_INVALID');}
  if(value&&typeof value.reply==='string'&&Array.isArray(value.memories)){try{value=JSON.parse(value.reply);}catch{throw fail('DSH_TASK_JSON_INVALID');}}
  if(!value||typeof value!=='object'||Array.isArray(value))throw fail('DSH_TASK_SCHEMA_INVALID');
  return {reply:JSON.stringify(value),memories:[],assetId:null,format:{mode:'local-task-json',warnings:[]}};
}
