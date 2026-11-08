// High-confidence audience checks happen before model or media work.
export function groupReplyGate(r,{quoteSelf=false,quoteOther=false,otherConversation=false}={}){
  if(!r.group)return {allow:true,reason:'private',explicit:true};
  const raw=(r.event?.message??[]).filter(s=>s.type==='text').map(s=>String(s.data?.text??'')).join('').trim();
  const namedDirect=!!r.word&&raw.startsWith(r.word);
  if(r.at||namedDirect||quoteSelf||r.social?.kind==='poke')return {allow:true,reason:'addressed-to-role',explicit:true};
  const others=(r.event?.message??[]).some(s=>s.type==='at'&&String(s.data?.qq)!==String(r.account));
  if(others||quoteOther)return {allow:false,reason:others?'addressed-to-other':'quoted-other',explicit:false};
  if(otherConversation)return {allow:false,reason:'other-conversation-continuation',explicit:false};
  const text=String(r.text??'').trim().replace(/[\s。.!！,，~～]+$/gu,'');
  if(/^(?:对|对啊|对呀|是|是啊|是的|嗯|嗯嗯|嗯哼|哦|哦哦|噢|好|好的|好啊|好呀|行|行啊|收到|了解|明白|谢谢|谢了|不用了|没事|哈哈|哈哈哈|ok|okay|yes)$/iu.test(text))return {allow:false,reason:'acknowledgement',explicit:false};
  return {allow:true,reason:r.explicitFollowup?'followup-candidate':r.word?'keyword-candidate':'natural-candidate',explicit:false};
}

export const GROUP_REPLY_NOTICE='群聊发言判断：触发/续聊/自然接话仅代表允许考虑，不是必须回答。先分清谁在对谁说话；群友明确@或引用另一人时，不代替那个人答话。没有向你提问、群友彼此商量、附和或话题已结束、你没有新增有用内容时，reply只返回[SILENT]，memories=[]、assetId=null；不发送“我不回复”等解释。只有与你有关、有明确邀请或接着你与该成员的对话时才自然回应。不要把他人收到的文字/语音当成自己已核实的程序状态，更不能未经实际确认就声称已接通、已配置或已完成。固定称呼关系不表示必须接每条群消息。';
