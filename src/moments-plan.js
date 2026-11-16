const DAY=86400000,OFFSET=8*3600000;

export function beijingDate(ms=Date.now()){
  return new Date(ms+OFFSET).toISOString().slice(0,10);
}

export function planWindow(ms,startHour,endHour){
  const date=beijingDate(ms),base=Date.parse(date+'T00:00:00+08:00');
  return {date,start:base+startHour*3600000,end:base+endHour*3600000};
}

export function nextPlanTime({now=Date.now(),startHour=9,endHour=22,random=Math.random,skipToday=false}={}){
  if(!Number.isInteger(startHour)||!Number.isInteger(endHour)||startHour<0||endHour>24||startHour>=endHour)throw Error('随机时间窗口应为同一天内的开始/结束小时');
  const {start,end}=planWindow(now,startHour,endHour);
  if(!skipToday&&now<end){
    const from=Math.max(now+60000,start);
    if(from<end)return Math.floor(from+random()*(end-from));
  }
  return Math.floor(start+DAY+random()*(end-start));
}

export function planLabel(plan){
  if(!plan?.enabled)return '未开启';
  return '每天 '+String(plan.startHour).padStart(2,'0')+':00–'+String(plan.endHour).padStart(2,'0')+':00 随机发布 · '+(plan.visibility==='public'?'公开':'私密');
}
