const speakerId=row=>{try{return String(JSON.parse(row.speaker)?.id??'');}catch{return String(row.speaker??'');}};
const stamp=value=>{const s=String(value??'');return Date.parse(s.replace(' ','T')+(/Z$|[+]\d\d:\d\d$/.test(s)?'':'Z'));};
const clean=text=>String(text??'').normalize('NFKC').trim().replace(/[?！!。…\s]+$/gu,'');
export const isConversationQuestion=text=>/[？?]|怎么|哪个|哪里|为什么|为啥|是什么|叫什么|叫啥|是谁|几岁|多少|要不要|是不是|有没有|还记得|能不能|可不可以/u.test(text);
export function shortFollowup(text){
  if(/^[？?]+$/u.test(String(text).trim()))return 'continue';
  const s=clean(text);if(!s||s.length>24||s.includes('\n'))return null;
  if(/^(?:你|您)?(?:还)?(?:知道|晓得|清楚|明白|懂|听懂|看懂|记得|确定)(?:了吗|了没|没有|吗|么|嘛|不|没)$/u.test(s))return 'check';
  if(/^(?:为什么|为啥|怎么说|然后呢|那后来呢|还有呢|所以呢|真的吗|真的假的|是吗|什么意思|你说呢|你觉得呢|那你呢|你呢|哪个|那呢)$/u.test(s)||/^[？?]+$/u.test(String(text).trim()))return 'continue';
  if(/^(?:不对|不是这个|不是这个意思|你理解错了|你说错了|我不是这个意思|错了)$/u.test(s))return 'correction';
  return null;
}
const brief=row=>({messageId:row.id,role:row.role,text:row.text.slice(0,240),...(speakerId(row)?{speakerId:speakerId(row)}:{})});

// Derive focus exclusively from the already-authorized window. No hidden topic
// store, cross-chat scan, model classification or long-term memory mutation.
export function conversationWindow(r,history,quote,{current,lookbackMs=180000}={}){
  const before=Math.min(...(r.turnParts??[]).map(x=>x.id).filter(Number.isSafeInteger),current?.id??Number.MAX_SAFE_INTEGER),currentAt=stamp(current?.created),followup=shortFollowup(r.text);
  const focus={kind:'current-message',currentSpeakerId:r.user,currentSourceIds:(r.turnParts??[]).map(x=>x.id),notice:'当前具体问题优先；旧话题和记忆不是待回答的问题。'};
  if(quote){Object.assign(focus,{kind:'explicit-quote',anchor:brief(quote),notice:'当前明确引用是指代锚点，按这条原文理解当前问题，不另选旧话题。'});return {history,focus,recallQuery:r.text+'\n引用对象：'+quote.text.slice(0,240),omittedIds:[]};}
  if(!followup)return {history,focus,recallQuery:r.text,omittedIds:[]};
  const own=history.filter(h=>h.role==='user'&&h.id<before&&speakerId(h)===String(r.user));let anchor=own.at(-1);
  if(followup==='correction'){
    // A message sent before a later answer cannot be reacting to that answer.
    const visible=history.filter(h=>h.role==='assistant'&&h.id<before).at(-1);
    if(visible){const source=own.find(h=>h.id===visible.replyToId||h.runId&&h.runId===visible.runId);anchor=source??visible;}else anchor=null;
  }
  const anchorAt=stamp(anchor?.created);
  if(!anchor||Number.isFinite(currentAt)&&Number.isFinite(anchorAt)&&(currentAt-anchorAt>lookbackMs||currentAt<anchorAt)){
    Object.assign(focus,{kind:'unresolved-followup',followup,notice:'这是没有可靠指代对象的短追问。只作简短具体的澄清，不从旧聊天、插件历史或长期记忆中任选事实当作答案。'});
    return {history:[],focus,recallQuery:'',omittedIds:history.map(x=>x.id)};
  }
  const replies=anchor.role==='user'?history.filter(h=>h.role==='assistant'&&(h.replyToId===anchor.id||anchor.runId&&h.runId===anchor.runId)):[];
  const earlier=own.filter(h=>h.id<anchor.id).at(-1),selfContained=followup==='check'&&isConversationQuestion(anchor.text)&&!/(?:这个|那个|这样|那样|它|刚才|刚刚|前面|上面|你说|你提|上次|之前)/u.test(anchor.text);
  const anchors=selfContained?[anchor]:[...(earlier?[earlier]:[]),anchor],runs=new Set(anchors.map(a=>a.runId).filter(Boolean)),ids=new Set(anchors.map(a=>a.id));
  const rows=history.filter(h=>ids.has(h.id)||h.role==='assistant'&&(ids.has(h.replyToId)||h.runId&&runs.has(h.runId)));
  // Legacy rows without run links still get a small chronological local window.
  if(!replies.length&&!anchor.runId){const index=history.findIndex(h=>h.id===anchors[0].id);for(const h of history.slice(index))if(h.role==='assistant'&&!h.runId&&!rows.some(x=>x.id===h.id))rows.push(h);}
  const selected=history.filter(h=>rows.some(x=>x.id===h.id));
  Object.assign(focus,{kind:'implicit-followup',followup,anchor:brief(anchor),answerMessageIds:replies.map(x=>x.id),receivedBeforeAnchorAnswer:replies.some(x=>x.id>before),notice:'当前短句接着anchor所表达的问题或话题；不要从更早聊天、记忆或插件补充历史另选话题。若在前一回复送达前收到，它是同一问题的补问/确认，不是假设用户已经看过后续回复的新问题。已回答时自然简短地确认，不说“刚答过/不是说过”，不把已明确的对象再泛泛追问一遍；不展开无关旧事。'});
  return {history:selected,focus,recallQuery:anchor.text.slice(0,240)+'\n当前追问：'+r.text,omittedIds:history.filter(h=>!selected.some(s=>s.id===h.id)).map(x=>x.id)};
}
