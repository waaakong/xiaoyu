const digits={零:0,〇:0,一:1,二:2,两:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9};
export function chineseNumber(s){if(/^\d+$/.test(s))return Number(s);if(s==='半')return .5;if(s.includes('十')){const [a,b]=s.split('十');return (a?digits[a]:1)*10+(b?digits[b]:0);}return digits[s];}
export const beijingStamp=at=>new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',dateStyle:'short',timeStyle:'medium',hour12:false}).format(at);
export function nextClock(now,hour,minute,{dayOffset=0,weekday}={}){
  const d=new Date(now+8*3600000),base=Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate(),hour-8,minute);
  if(weekday!==undefined){let delta=(weekday-d.getUTCDay()+7)%7;if(!delta&&base<=now)delta=7;return base+delta*86400000;}
  return base+dayOffset*86400000+(dayOffset===0&&base<=now?86400000:0);
}
export function parseLocalTime(value){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(value))throw Error('请提供明确的北京时间');const at=Date.parse(value.replace(' ','T')+':00+08:00');if(!Number.isFinite(at)||new Date(at+8*3600000).toISOString().slice(0,16).replace('T',' ')!==value)throw Error('日期或时刻不存在');return at;}
export function taskIntent(text){return /^\/(?:定时|任务|取消任务|确认任务|暂停定时任务|继续定时任务)(?:\s|$)/u.test(text)||!/(?:他说|她说|有人说|举例|例如|如果|假如|听说|为什么)/u.test(text)&&/(?:后|明天|今天|今晚|每天|每周|下周|下星期|\d{4}[-年/]|\d{1,2}月|\d[:：]\d|[零一二两三四五六七八九十\d]+[点时])/u.test(text)&&/(?:提醒|叫我|找我|告诉我|发|说|@我)/u.test(text);}
export function parseScheduledRequest(text,now=Date.now()){
  if(/^[“"「『>]/u.test(String(text).trim())||/(?:你会|是否会|会不会).*(?:发|说)|(?:什么时候|几点).*(?:发|提醒)|(?:发|提醒).*(?:是什么意思|怎么实现|可行吗)/u.test(text))return {clarify:'这是讨论还是要建立定时任务？如需执行，请明确时间及提醒正文。'};
  let s=String(text).trim().replace(/^\/定时\s*/u,'').replace(/^(?:请|麻烦|帮我|能不能|可以)?\s*/u,'');
  if(/群发|所有群|全部群|所有好友|其他群|另一个群|转账|付款|支付/u.test(s))return {clarify:'请明确在当前聊天发送的提醒内容；当前不执行群发、跨聊天发送或付款。'};
  if(/发给|发送给|给.+?(?:发|提醒)|(?:到|向|在).{1,20}群/u.test(s.replace(/在本群|在群里|在当前群/gu,'')))return {clarify:'当前只支持本聊天提醒，请明确本聊天的提醒正文，不会跨聊天发送。'};
  if(/每(?:隔)?[零一二两三四五六七八九十\d]+(?:秒|分|小时)/u.test(s))return {clarify:'周期任务目前支持每天或每周一次，请明确一个北京时间和提醒正文。'};
  if(/下星期|本周|星期|\d{4}[-年/]|\d{1,2}月|下个月|月底/u.test(s))return {complex:true};
  const style=/按(?:你的|当前)?人设|用(?:你的)?口吻/u.test(s),voice=/用语音|语音提醒|语音说/u.test(s),mention=/@我|艾特我/u.test(s);
  let due,interval=0,repeat='once',timePart='';
  const relative=/([零〇一二两三四五六七八九十\d]+|半)\s*(秒钟?|分钟?|小时|天)\s*(?:以)?后/u.exec(s);
  const daily=/每天\s*(?:(上午|下午|晚上|中午|凌晨)\s*)?([零一二两三四五六七八九十\d]+)(?:[:：点时])(?:\s*([零一二两三四五六七八九十\d]+|半)\s*分?)?/u.exec(s);
  const weekly=/每周([一二三四五六日天])\s*(?:(上午|下午|晚上|中午|凌晨)\s*)?([零一二两三四五六七八九十\d]+)(?:[:：点时])(?:\s*([零一二两三四五六七八九十\d]+|半)\s*分?)?/u.exec(s);
  const clock=/(今天|明天|后天|今晚|下周[一二三四五六日天])?\s*(?:(上午|下午|晚上|中午|凌晨)\s*)?([零一二两三四五六七八九十\d]+)[:：点时]([零一二两三四五六七八九十\d]+|半)?\s*分?/u.exec(s);
  const clockTime=(period,h,m)=>{let hour=chineseNumber(h),minute=m==='半'?30:m?chineseNumber(m):0;if(['下午','晚上','中午'].includes(period)&&hour<12)hour+=12;if(period==='凌晨'&&hour===12)hour=0;if(!Number.isInteger(hour)||hour<0||hour>23||!Number.isInteger(minute)||minute<0||minute>59)throw Error('时间无效，请使用北京时间，例如明天18:30');return {hour,minute};};
  if(relative&&/今天|明天|后天|今晚|下周/u.test(s))return {clarify:'要求中有多个时间，请明确一个执行时间。'};
  if(relative){const n=chineseNumber(relative[1]),unit=relative[2],factor=unit.startsWith('秒')?1000:unit.startsWith('分')?60000:unit==='小时'?3600000:86400000;if(!Number.isFinite(n)||n*factor<1000||n*factor>30*86400000)throw Error('延迟范围1秒至30天');due=now+n*factor;timePart=relative[0];}
  else if(weekly){const t=clockTime(weekly[2],weekly[3],weekly[4]);due=nextClock(now,t.hour,t.minute,{weekday:'日一二三四五六'.indexOf(weekly[1]==='天'?'日':weekly[1])});repeat='weekly';interval=7*86400000;timePart=weekly[0];}
  else if(daily){const t=clockTime(daily[1],daily[2],daily[3]);due=nextClock(now,t.hour,t.minute);repeat='daily';interval=86400000;timePart=daily[0];}
  else if(clock){const t=clockTime(clock[2]??(clock[1]==='今晚'?'晚上':null),clock[3],clock[4]);due=nextClock(now,t.hour,t.minute,{dayOffset:clock[1]==='明天'?1:clock[1]==='后天'?2:0,...(clock[1]?.startsWith('下周')?{weekday:'日一二三四五六'.indexOf(clock[1].slice(-1)==='天'?'日':clock[1].slice(-1))}: {})});if(['今天','今晚'].includes(clock[1])&&new Date(due+8*3600000).toISOString().slice(0,10)!==new Date(now+8*3600000).toISOString().slice(0,10))throw Error('今天这个时间已过，请指定未来时间');if(clock[1]?.startsWith('下周')){const d=new Date(now+8*3600000),currentDay=d.getUTCDay()||7,target='一二三四五六日'.indexOf(clock[1].slice(-1)==='天'?'日':clock[1].slice(-1))+1;const date=new Date(now+(7-currentDay+target)*86400000+8*3600000);due=Date.UTC(date.getUTCFullYear(),date.getUTCMonth(),date.getUTCDate(),t.hour-8,t.minute);}repeat='once';timePart=clock[0];}
  if(!due)return {complex:true};
  let content=s.replace(timePart,'').replace(/按(?:你的|当前)?人设|用(?:你的)?口吻|用语音|语音提醒|语音说|@我|艾特我/gu,'').replace(/^[\s,，。:：]*(?:在本群|在群里|在这里|在本聊天)?[\s,，:：]*(?:提醒我|告诉我|叫我|找我|提醒|发送|发一句|发|说一句|说)?[\s,，:：]*/u,'').trim();
  if(!content&&mention)content='时间到啦';if(!content||/^(?:消息|一句话|个消息|一下|我|吗|么)$/u.test(content))return {clarify:'到时需要提醒什么？请把时间和具体内容写在同一条消息，例如“5分钟后提醒我喝水”。'};
  return {due:Math.round(due),interval,repeat,content,voice,mentionSelf:mention,style};
}
