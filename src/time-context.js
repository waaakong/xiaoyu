const DEFAULT_ZONE='Asia/Shanghai';
const weekdays=['周日','周一','周二','周三','周四','周五','周六'];
const clockFormats=new Map();
function formatter(timeZone){
  let f=clockFormats.get(timeZone);
  if(!f){
    f=new Intl.DateTimeFormat('en-US',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23',weekday:'short',timeZoneName:'longOffset'});
    clockFormats.set(timeZone,f);
  }
  return f;
}
export function zoneParts(at=Date.now(),timeZone=DEFAULT_ZONE){
  const parts=Object.fromEntries(formatter(timeZone).formatToParts(new Date(at)).map(p=>[p.type,p.value]));
  const weekday=weekdays[new Date(Date.UTC(Number(parts.year),Number(parts.month)-1,Number(parts.day))).getUTCDay()];
  const raw=String(parts.timeZoneName??'GMT');const offset=raw==='GMT'?'+00:00':raw.replace('GMT','')||'+08:00';
  return {date:`${parts.year}-${parts.month}-${parts.day}`,time:`${parts.hour}:${parts.minute}:${parts.second}`,weekday,offset,timeZone};
}
export function clockText(at=Date.now(),{timeZone=DEFAULT_ZONE,seconds=true}={}){
  const p=zoneParts(at,timeZone);return `${p.date} ${seconds?p.time:p.time.slice(0,5)}`;
}
export function dayText(at=Date.now(),{timeZone=DEFAULT_ZONE}={}){return zoneParts(at,timeZone).date;}
export function sqliteUtcToMs(value){
  const text=String(value??'').trim();if(!text)return null;
  const at=Date.parse(/T|Z|[+-]\d{2}:?\d{2}$/u.test(text)?text:text.replace(' ','T')+'Z');
  return Number.isFinite(at)?at:null;
}
export function idleText(ms){
  if(!Number.isFinite(ms)||ms<0)return '未知';
  if(ms<60000)return '不到1分钟';
  if(ms<3600000)return Math.floor(ms/60000)+'分钟';
  if(ms<86400000){const h=Math.floor(ms/3600000),m=Math.floor(ms%3600000/60000);return m?h+'小时'+m+'分钟':h+'小时';}
  const d=Math.floor(ms/86400000),h=Math.floor(ms%86400000/3600000);return h?d+'天'+h+'小时':d+'天';
}
export function timeContext({now=Date.now(),timeZone=DEFAULT_ZONE,lastTurnAt=null,lastTurnLabel='上一轮对话'}={}){
  const p=zoneParts(now,timeZone),lines=[`现在是 ${p.date} ${p.time}（${p.weekday}，${timeZone}，UTC${p.offset}）。`];
  if(Number.isFinite(lastTurnAt)&&lastTurnAt<=now){const idle=now-lastTurnAt;lines.push(`${lastTurnLabel}结束于 ${clockText(lastTurnAt,{timeZone})}，中间空闲了 ${idleText(idle)}（约 ${Math.round(idle/1000)} 秒）。`);}
  else lines.push(`还没有可用的${lastTurnLabel}记录。`);
  lines.push('回答“现在几点、今天几号、星期几、多久没聊”时以上面的真实时间为准；不要猜测或编造时间，也不要把时间说明当成用户说过的话。');
  return '### 当前时间\n'+lines.join('\n');
}
