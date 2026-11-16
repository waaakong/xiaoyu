const stamp=x=>{const s=String(x??'');return Date.parse(s.replace(' ','T')+(/Z$|[+]\d\d:\d\d$/.test(s)?'':'Z'));};
export function memoryImportance(m){
 if(m.pinned||m.type==='commitment')return 1.5;
 if(/重要|请记住|一定记住|心事|难忘|第一次|一起|我们之间/u.test(m.evidence??''))return 1.3;
 if(m.type==='preference')return 1.15;
 return /琐事|闲聊|随口|重复测试/u.test(m.key??'')?.6:1;
}
export function oldMemoryNotice(m,now=Date.now()){
 if(m.pinned||m.type==='commitment'||memoryImportance(m)>1.2)return '';
 const at=stamp(m.confirmedAt??m.updated??m.firstSeen);if(!Number.isFinite(at))return '';
 const age=(now-at)/86400000;
 if(m.type==='event'&&age>90)return '旧事细节仅供回想，不确定时明确说记不清，不补造';
 if(m.type==='preference'&&age>180)return '较久未确认的偏好，必要时询问是否仍然如此';
 return '';
}
