export const starTypes={
  relationship:['关系表达','#eeb8ce'],
  fixed:['固定','#ffd696'],
  fact:['事实','#9ee8dc'],
  event:['经历','#b2ccff'],
  note:['日记','#ffaad4'],
  topic:['知识','#c9b8ff'],
  plan:['约定','#ffd696'],
  person:['人物','#8fe6d2'],
  chat:['聊天','#9fb8d8'],
  persona:['人格','#b9a2ff']
};

const TAU=Math.PI*2;
const GAL_R=5.8;
const SPIRAL=1.22;
const clamp=(v,a,b)=>v<a?a:v>b?b:v;
const hash=s=>{let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}return (h>>>0)/4294967295;};
const gauss=()=>(Math.random()+Math.random()+Math.random())/1.5-1;
const easeOutBack=x=>{const c1=1.70158,c3=c1+1;return 1+c3*Math.pow(x-1,3)+c1*Math.pow(x-1,2);};
const easeOutCubic=x=>1-Math.pow(1-x,3);
const rgbOf=hex=>{const s=String(hex||'#cfe9df').replace('#','');return [parseInt(s.slice(0,2),16)||0,parseInt(s.slice(2,4),16)||0,parseInt(s.slice(4,6),16)||0].join(',');};
const stamp=value=>String(value??'').replace(' ','T').replace(/^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)$/,'$1Z');
const timeOf=value=>{const n=Date.parse(stamp(value));return Number.isFinite(n)?n:0;};
const recordTypes=new Set(['fixed','fact','event','note','topic','plan','relationship']);
const PAL={relationship:'238,184,206',fixed:'255,214,150',fact:'158,232,220',event:'178,204,255',note:'255,170,212',topic:'201,184,255',plan:'255,214,150',person:'143,230,210',chat:'159,184,216',persona:'185,162,255',center:'236,226,255'};
const FALLBACK='216,206,255';

export function createStarCanvas(canvas,{onSelect=()=>{},onHover=()=>{}}={}){
  const ctx=canvas.getContext('2d',{alpha:false});
  const motion=matchMedia('(prefers-reduced-motion: reduce)');
  const reduced=()=>motion.matches||window.xyMotionDisabled?.();
  let W=1,H=1,DPR=1,FOCAL=900,REF=100,cosT=1,sinT=0,cosP=1,sinP=0;
  let theta=.5,phi=.30,dist=13.5,distGoal=9.2,phiOff=0,intro=0,introStart=performance.now();
  let dragging=false,lastPointer=null,downAt=null,hovered=null,selectedId='',auto=true,active=false,destroyed=false;
  let mode='galaxy',frame=0,last=0,lastDraw=0,drawCount=0,totalDrawMs=0,maxDrawMs=0,started=false,dataSig='';
  let nodes=[],edges=[],records=[],structural=[],centerNode=null,stars=[],starById=new Map(),extraStars=[],extraById=new Map(),groupEdges=new Map();
  let newest=null,likes=new Set();
  let labelBoxes=[];
  const buckets=new Map();
  const spriteCache=new Map();
  const cloudCache=new Map();
  const NEB_DUST=[];
  let cvRect={left:0,top:0};
  let sizeKey='';

  try{likes=new Set(JSON.parse(localStorage.getItem('xiaoyu-star-likes')||'[]'));}catch{}
  const saveLikes=()=>{try{localStorage.setItem('xiaoyu-star-likes',JSON.stringify([...likes]));}catch{}};

  function pushPart(x,y,z,size,alpha,rgb,slow){
    if(!buckets.has(rgb))buckets.set(rgb,[]);
    buckets.get(rgb).push({x,y,z,s:size,a:alpha,ph:Math.random()*TAU,sp:.4+Math.random()*1.2,d:Math.random(),slow:!!slow});
  }

  function buildGalaxy(){
    if(buckets.size)return;
    for(let i=0;i<15000;i++){
      const r=.05+Math.pow(Math.random(),.60)*GAL_R;
      const arm=Math.random()<.5?0:Math.PI;
      const spread=.28+.85*(r/GAL_R);
      const stray=Math.random()<.42;
      const a=arm+SPIRAL*r+gauss()*spread*(stray?2.8:1);
      const thin=1-Math.min(1,r/GAL_R)*.5;
      const y=gauss()*.62*thin;
      const k=Math.min(1,r/GAL_R);
      const rgb=k<.22?'255,224,240':(k<.55?'250,192,232':(Math.random()<.10?'150,232,220':'206,176,248'));
      pushPart(Math.cos(a)*r,y,Math.sin(a)*r,.42+Math.random()*.9,.12+Math.random()*.42,rgb);
    }
    for(let i=0;i<1200;i++){
      const r=Math.pow(Math.random(),1.7)*1.05;
      const a=Math.random()*TAU;
      pushPart(Math.cos(a)*r,gauss()*.55,Math.sin(a)*r,.45+Math.random()*.85,.18+Math.random()*.5,'255,244,252');
    }
    for(let i=0;i<2600;i++){
      const r=1.2+Math.pow(Math.random(),.7)*5.2;
      const a=Math.random()*TAU;
      pushPart(Math.cos(a)*r,gauss()*(.8+r*.3),Math.sin(a)*r,.4+Math.random()*.7,.20+Math.random()*.45,'198,204,252',true);
    }
    for(let i=0;i<4200;i++){
      const r=6+Math.random()*16;
      const u=Math.random()*2-1,a=Math.random()*TAU,sq=Math.sqrt(1-u*u);
      pushPart(r*sq*Math.cos(a),r*u*.85,r*sq*Math.sin(a),.32+Math.random()*.8,.34+Math.random()*.56,Math.random()<.12?'255,226,180':'228,232,255',true);
    }
    for(let i=0;i<180;i++){
      const r=.2+Math.pow(Math.random(),.7)*GAL_R*.95;
      const arm=Math.random()<.5?0:Math.PI;
      const a=arm+SPIRAL*r+gauss()*.6;
      pushPart(Math.cos(a)*r,gauss()*.5,Math.sin(a)*r,1.2+Math.random()*1.3,.45+Math.random()*.45,Math.random()<.2?'255,226,185':'235,230,255');
    }
    for(let i=0;i<280;i++){
      const r=.30+Math.pow(Math.random(),.72)*GAL_R*1.02;
      const arm=Math.random()<.5?0:Math.PI;
      const a=arm+SPIRAL*r+gauss()*(.055+.075*(r/GAL_R));
      const k=r/GAL_R;
      NEB_DUST.push({x:Math.cos(a)*r*.985,z:Math.sin(a)*r*.985,y:gauss()*.07,r:.7+Math.random()*2.1,a:.14+Math.random()*.26,v:(Math.random()*3)|0});
    }
  }

  function buildCloudFields(){
    if(cloudCache.size)return;
    const fields=[];
    for(const seed of [12345,98765,31337]){
      let s=(seed>>>0)||1;
      const rnd=()=>{s=(s*1664525+1013904223)>>>0;return s/4294967296;};
      const oct=[];
      for(let o=0;o<4;o++){const gs=4<<o,g=new Float32Array(gs*gs);for(let i=0;i<g.length;i++)g[i]=rnd();oct.push({gs,g});}
      const S=128,out=new Uint8ClampedArray(S*S);
      for(let y=0;y<S;y++)for(let x=0;x<S;x++){
        const nx=x/S,ny=y/S;let sum=0,amp=1,norm=0;
        for(const O of oct){const gs=O.gs,fx=nx*gs,fy=ny*gs,x0=Math.floor(fx)%gs,y0=Math.floor(fy)%gs,x1=(x0+1)%gs,y1=(y0+1)%gs,tx=fx-Math.floor(fx),ty=fy-Math.floor(fy),sx=tx*tx*(3-2*tx),sy=ty*ty*(3-2*ty),a1=O.g[y0*gs+x0],b1=O.g[y0*gs+x1],c1=O.g[y1*gs+x0],d1=O.g[y1*gs+x1];sum+=(a1*(1-sx)*(1-sy)+b1*sx*(1-sy)+c1*(1-sx)*sy+d1*sx*sy)*amp;norm+=amp;amp*=.5;}
        const dx=nx-.5,dy=ny-.5,dd=Math.sqrt(dx*dx+dy*dy)*2,fall=Math.pow(Math.max(0,1-dd),2.2),nv=sum/norm;
        out[y*S+x]=Math.round(Math.min(1,Math.max(0,(nv-.30))*2.6*fall)*255);
      }
      fields.push({size:S,data:out});
    }
    cloudCache.set('fields',fields);
  }

  function cloudSprite(field,rgb){
    const key=field+'|'+rgb;
    if(cloudCache.has(key))return cloudCache.get(key);
    const fields=cloudCache.get('fields')||[];const F=fields[field%fields.length];if(!F)return null;
    const S=F.size,cv=document.createElement('canvas');cv.width=cv.height=S;const c2=cv.getContext('2d'),img=c2.createImageData(S,S),parts=rgb.split(',').map(Number);
    for(let i=0;i<S*S;i++){const o=i*4;img.data[o]=parts[0];img.data[o+1]=parts[1];img.data[o+2]=parts[2];img.data[o+3]=F.data[i];}
    c2.putImageData(img,0,0);cloudCache.set(key,cv);return cv;
  }

  function dot(rgb){
    if(spriteCache.has(rgb))return spriteCache.get(rgb);
    const S=128,c=document.createElement('canvas');c.width=c.height=S;const g=c.getContext('2d'),cx=S/2,rg=g.createRadialGradient(cx,cx,0,cx,cx,cx);
    rg.addColorStop(0,'rgba('+rgb+',1)');rg.addColorStop(.12,'rgba('+rgb+',.72)');rg.addColorStop(.34,'rgba('+rgb+',.16)');rg.addColorStop(1,'rgba('+rgb+',0)');
    g.fillStyle=rg;g.fillRect(0,0,S,S);spriteCache.set(rgb,c);return c;
  }

  function drawSprite(s,x,y,r,a){
    if(!s||a<=.004||r<=0)return;
    ctx.globalAlpha=a>1?1:a;ctx.drawImage(s,x-r,y-r,r*2,r*2);ctx.globalAlpha=1;
  }

  function sparkle(x,y,r,rgb,a){
    if(a<=.02||r<.6)return;
    ctx.globalAlpha=a;ctx.beginPath();
    for(let i=0;i<8;i++){const ang=-Math.PI/2+i*Math.PI/4,rr=i%2===0?r:r*.17,px=x+Math.cos(ang)*rr,py=y+Math.sin(ang)*rr;i?ctx.lineTo(px,py):ctx.moveTo(px,py);}
    ctx.closePath();ctx.fillStyle='rgb('+rgb+')';ctx.fill();ctx.globalAlpha=1;
  }

  function project(x,y,z){
    const x1=x*cosT+z*sinT,z1=-x*sinT+z*cosT,y2=y*cosP-z1*sinP,z2=y*sinP+z1*cosP,vz=dist-z2;
    if(vz<.6)return null;const s=FOCAL/vz;
    return {x:W/2+x1*s,y:H/2-y2*s,s,vz};
  }

  function colorOf(n){return PAL[n.type]||FALLBACK;}
  function groupOf(n){return n.type||'other';}

  function rebuild(){
    records=nodes.filter(n=>recordTypes.has(n.type));
    structural=nodes.filter(n=>!recordTypes.has(n.type)&&n.type!=='center');
    centerNode=nodes.find(n=>n.type==='center')||{id:'center',type:'center',title:'小鱼',summary:''};
    const now=Date.now();
    const times=records.map(n=>timeOf(n.created||n.updated)).filter(Boolean);
    const tMin=Math.min(now,...(times.length?times:[now]));
    const tMax=Math.max(tMin+1,...(times.length?times:[tMin+1]));
    const sorted=records.slice().sort((a,b)=>timeOf(a.created||a.updated)-timeOf(b.created||b.updated));
    const rankOf=new Map(),groupSum=new Map(),groupCnt=new Map(),groupArm=new Map();
    sorted.forEach((n,i)=>{
      const rank=sorted.length>1?i/(sorted.length-1):.5;
      const rb=(n.type==='fixed'?.82:.85+4.30*Math.pow(rank,.85));
      rankOf.set(n.id,rb);
      const g=groupOf(n);
      groupSum.set(g,(groupSum.get(g)||0)+rb);groupCnt.set(g,(groupCnt.get(g)||0)+1);
      if(!groupArm.has(g))groupArm.set(g,hash('arm:'+g)<.5?0:Math.PI);
    });
    stars=[];starById=new Map();newest=null;
    sorted.forEach(n=>{
      const at=timeOf(n.created||n.updated)||tMin;
      const rank=sorted.length>1?rankOf.get(n.id):0;
      const h=hash(String(n.id||n.title||''));
      const g=groupOf(n),gMean=(groupSum.get(g)||rank)/Math.max(1,groupCnt.get(g)||1);
      const rTime=n.type==='fixed'?.85+ (h-.5)*.18 : rankOf.get(n.id);
      const rr=clamp(.45*rTime+.55*gMean+(h-.5)*1.9,.5,GAL_R*1.06);
      const base=(groupArm.get(g)||0)+(n.type==='event'?.12:(n.type==='persona'?-.12:0));
      const a=base+SPIRAL*rr+(h-.5)*1.0;
      const weight=clamp(Number(n.weight??1),.2,4);
      const imp=clamp((weight-.65)/2.35,0,1);
      const recency=clamp((at-tMin)/Math.max(1,tMax-tMin),0,1);
      const mag=.06+Math.random()*.38;
      const y=imp>=.45?mag:(Math.random()<.22?-mag:mag);
      const size=(3.4+imp*4.2+(n.type==='fixed'?1.2:0))*(.78+.42*recency);
      const star={...n,rgb:colorOf(n),x:Math.cos(a)*rr,y,z:Math.sin(a)*rr,size,imp,at,recency,phase:h*TAU,ping:0,label:false};
      stars.push(star);starById.set(star.id,star);
      if(!newest||star.at>newest.at)newest=star;
    });
    const labelStars=[];
    for(const s of stars.slice().sort((a,b)=>b.imp-a.imp)){
      if(labelStars.every(p=>Math.hypot(p.x-s.x,p.z-s.z)>1.55))labelStars.push(s);
      if(labelStars.length>=5)break;
    }
    for(const s of stars)s.label=labelStars.includes(s);
    groupEdges=new Map();
    for(const type of recordTypes){
      const list=stars.filter(s=>s.type===type).sort((a,b)=>a.at-b.at),prev=[];
      for(const s of list){
        let best=null,bd=Infinity;
        for(const p of prev){const dx=p.x-s.x,dy=p.y-s.y,dz=p.z-s.z,d=dx*dx+dy*dy+dz*dz;if(d<bd){bd=d;best=p;}}
        if(best&&bd<9){(groupEdges.get(type)||groupEdges.set(type,[]).get(type)).push({a:best.id,b:s.id,label:'视觉同组（非事实关系）'});}
        prev.push(s);
      }
    }
    extraStars=[];
    if(mode==='relations'){
      const linked=new Map();
      for(const e of edges){if(starById.has(e.a)&&!starById.has(e.b)){if(!linked.has(e.b))linked.set(e.b,[]);linked.get(e.b).push(starById.get(e.a));}if(starById.has(e.b)&&!starById.has(e.a)){if(!linked.has(e.a))linked.set(e.a,[]);linked.get(e.a).push(starById.get(e.b));}}
      structural.forEach((n,i)=>{
        const near=linked.get(n.id)||[];
        const h=hash(String(n.id));
        let x,y,z;
        if(near.length){x=near.reduce((s,p)=>s+p.x,0)/near.length;y=near.reduce((s,p)=>s+p.y,0)/near.length;z=near.reduce((s,p)=>s+p.z,0)/near.length;const rr=.55+ (n.type==='person'?.9:n.type==='chat'?1.2:1.5);x+=Math.cos(h*TAU)*rr;z+=Math.sin(h*TAU)*rr;y+=.08;}
        else{const rr=n.type==='persona'?2.0:n.type==='person'?3.3:4.6;const a=h*TAU+i*.31;x=Math.cos(a)*rr;y=.1;z=Math.sin(a)*rr;}
        const star={...n,rgb:colorOf(n),x,y,z,size:n.type==='persona'?4.6:n.type==='person'?4.2:3.5,imp:.55,at:0,recency:0,phase:h*TAU,ping:0};
        extraStars.push(star);extraById.set(star.id,star);
      });
    }else{extraById=new Map();}
    if(selectedId&&!starById.has(selectedId)&&!extraById.has(selectedId)&&selectedId!==centerNode?.id)selectedId='';
  }

  function setData(value={}){
    nodes=Array.isArray(value.nodes)?value.nodes:[];
    edges=Array.isArray(value.edges)?value.edges:[];
    const sig=nodes.map(n=>n.id+':'+n.weight+':'+n.created).join('|');
    rebuild();
    if(records.length&&!started){started=true;replayIntro();}
    if(!records.length){started=false;selectedId='';hovered=null;}
    dataSig=sig;lastDraw=0;
  }

  function replayIntro(){
    intro=0;introStart=performance.now();theta=.5;phi=.30;dist=13.5;distGoal=9.2;selectedId='';hovered=null;onHover(null);
  }

  function resize(){
    const rect=canvas.getBoundingClientRect();W=Math.max(2,Math.round(rect.width));H=Math.max(2,Math.round(rect.height));cvRect=rect;
    DPR=Math.min(2.5,Math.max(devicePixelRatio||1,1.35));canvas.width=Math.round(W*DPR);canvas.height=Math.round(H*DPR);ctx.setTransform(DPR,0,0,DPR,0,0);
    FOCAL=Math.min(W,H)*1.05;REF=FOCAL/9.2;
    const key=W+'x'+H;if(key!==sizeKey){sizeKey=key;}
    lastDraw=0;
  }

  function drawBackground(){
    const dark=clamp(intro/.7,0,1);
    const bg=ctx.createRadialGradient(W*.5,H*.5,0,W*.5,H*.5,Math.max(W,H)*.75);
    bg.addColorStop(0,'rgba('+Math.round(9*dark)+','+Math.round(4*dark)+','+Math.round(14*dark)+',1)');
    bg.addColorStop(.5,'rgba('+Math.round(5*dark)+','+Math.round(2*dark)+','+Math.round(9*dark)+',1)');
    bg.addColorStop(1,'rgba(2,1,4,1)');
    ctx.fillStyle=bg;ctx.fillRect(0,0,W,H);
  }

  function drawDust(){
    if(!NEB_DUST.length)return;
    ctx.globalCompositeOperation='source-over';
    for(const d0 of NEB_DUST){
      const q=project(d0.x,d0.y,d0.z);if(!q)continue;
      const rr=Math.max(8,d0.r*q.s*.55),al=Math.min(.42,d0.a*(.4+.6*clamp(intro/.7,0,1))*clamp(intro/.9,0,1));
      if(al<.004)continue;
      const spr=cloudSprite(d0.v,'8,7,12');if(!spr)continue;
      ctx.globalAlpha=al;ctx.drawImage(spr,q.x-rr*2.2,q.y-rr*.9,rr*4.4,rr*1.8);ctx.globalAlpha=1;
    }
    ctx.globalCompositeOperation='lighter';
  }

  function drawParticles(){
    const introLit=clamp((intro-.55)/1.7,0,1);
    ctx.globalCompositeOperation='lighter';
    for(const [rgb,list] of buckets){
      ctx.fillStyle='rgb('+rgb+')';
      for(const p of list){
        const q=project(p.x,p.y,p.z);if(!q)continue;
        const lit=clamp((intro-.55-p.d*1.7)/.5,0,1);if(lit<=0)continue;
        const tw=p.slow?.92+.08*Math.sin(intro*p.sp*.4+p.ph):.80+.20*Math.sin(intro*p.sp+p.ph);
        const a=Math.min(1,p.a*1.55*lit*tw*clamp(1.25-.45*(q.vz/dist),.15,1.2));if(a<.01)continue;
        const sz=Math.max(.6,p.s*(q.s/REF)*1.2);
        if(p.slow)drawSprite(dot(rgb),q.x,q.y,Math.max(1.6,sz*2.1),Math.min(.85,a*1.15));
        else{ctx.globalAlpha=a>1?1:a;if(sz<1.5)ctx.fillRect(q.x,q.y,sz,sz);else{ctx.beginPath();ctx.arc(q.x,q.y,sz*.5,0,TAU);ctx.fill();}}
      }
    }
    ctx.globalAlpha=1;
  }

  function drawCore(){
    const reveal=clamp((intro-.8)/1.6,0,1);if(reveal<=0)return;
    const breathe=1+.20*Math.sin(intro*1.1);
    const cores=[[-.30,236,226,255,78,.26],[.30,255,214,150,54,.22]];
    for(const [ox,r,g,b,size,alpha] of cores){
      const q=project(ox,0,0);if(!q)continue;
      const ps=q.s/REF;
      drawSprite(dot(r+','+g+','+b),q.x,q.y,size*ps*breathe,alpha*reveal);
      drawSprite(dot(r+','+g+','+b),q.x,q.y,30*ps,.85*reveal);
      drawSprite(dot('255,255,255'),q.x,q.y,7*ps,1*reveal);
    }
    const q=project(-.30,0,0);
    if(q&&intro>2.8){ctx.globalCompositeOperation='source-over';ctx.font='10px ui-sans-serif,system-ui,"Microsoft YaHei",sans-serif';ctx.textAlign='center';ctx.fillStyle='rgba(232,226,255,.48)';ctx.fillText(centerNode?.title||'小鱼',q.x,q.y+38);ctx.globalCompositeOperation='lighter';}
  }

  function constellationFor(id){
    const out=[];
    const n=starById.get(id);
    if(n){for(const e of groupEdges.get(n.type)||[])out.push(e);}
    for(const e of edges)if(e.a===id||e.b===id)if(starById.has(e.a)&&starById.has(e.b))out.push(e);
    return out;
  }

  function drawEdges(){
    if(!selectedId)return;
    const list=constellationFor(selectedId);if(!list.length)return;
    const sel=starById.get(selectedId)||extraById.get(selectedId)||centerNode;const rgb=colorOf(sel);
    ctx.globalCompositeOperation='lighter';
    for(const e of list){
      const a=starById.get(e.a)||extraById.get(e.a),b=starById.get(e.b)||extraById.get(e.b);if(!a||!b)continue;
      const qa=project(a.x,a.y,a.z),qb=project(b.x,b.y,b.z);if(!qa||!qb)continue;
      const hot=e.a===selectedId||e.b===selectedId;
      ctx.strokeStyle='rgba('+rgb+','+(hot?.68:.36)+')';ctx.lineWidth=hot?1.6:1;ctx.beginPath();ctx.moveTo(qa.x,qa.y);ctx.lineTo(qb.x,qb.y);ctx.stroke();
    }
  }

  function labelFor(n,q,r){
    const text=String(n.title||n.summary||'').trim();if(!text)return;
    const label=text.length>22?text.slice(0,22)+'…':text;
    ctx.globalCompositeOperation='source-over';ctx.font='12px ui-sans-serif,system-ui,"Microsoft YaHei",sans-serif';ctx.textAlign='center';
    const tw=ctx.measureText(label).width,bw=tw+18,bh=23;
    const bx=clamp(q.x-tw/2-9,8,W-tw-26),by=clamp(q.y-r*3.6-32,8,H-32);
    if(labelBoxes.some(b=>!(bx+bw<b.x||bx>b.x+b.w||by+bh<b.y||by>b.y+b.h)))return;
    labelBoxes.push({x:bx,y:by,w:bw,h:bh});
    ctx.strokeStyle='rgba(180,198,255,.2)';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(q.x,q.y-r*2.2);ctx.lineTo(q.x,by+bh);ctx.stroke();
    ctx.fillStyle='rgba(7,5,18,.80)';ctx.fillRect(bx,by,bw,bh);
    ctx.fillStyle='rgba(246,242,255,.96)';ctx.fillText(label,q.x,by+16);
    ctx.globalCompositeOperation='lighter';
  }

  function drawStars(){
    const reveal=clamp((intro-.9)/.8,0,1);if(reveal<=0)return;labelBoxes=[];
    const focus=n=>f=>f;
    const activeSet=new Set([selectedId]);
    if(selectedId)for(const e of constellationFor(selectedId)){activeSet.add(e.a);activeSet.add(e.b);}
    const all=[...stars,...(mode==='relations'?extraStars:[])];
    for(const n of all){
      const q=project(n.x,n.y,n.z);if(!q)continue;
      let lit=clamp((intro-.9-n.phase*.4)/.8,0,1);
      let pop=1;
      if(n===newest){const raw=clamp((intro-3)/1,0,1);lit=raw;pop=raw<=0?0:easeOutBack(raw);}
      if(lit<=0)continue;
      const ps=q.s/REF,tw=.88+.12*Math.sin(intro*1.1+n.phase);
      const isSel=n.id===selectedId,isHover=n.id===hovered?.id,hot=isSel?1:isHover?.75:0;
      const liked=likes.has(n.id);
      const r=n.size*ps*(isSel?2:isHover?1.35:1)*(n===newest?Math.max(.6,pop):1);
      const al=lit*(n===newest?Math.min(1.6,Math.max(0,pop)):1);
      if(selectedId&&!activeSet.has(n.id))ctx.globalAlpha=.34;
      const rgb=n.rgb||colorOf(n);
      drawSprite(dot(rgb),q.x,q.y,r*7.2,(.16+hot*.3)*al);
      drawSprite(dot(rgb),q.x,q.y,r*4.1,(.20+hot*.3)*al);
      drawSprite(dot(rgb),q.x,q.y,r*1.75,((.58+n.imp*.28)*tw+hot*.22)*al);
      drawSprite(dot('255,255,255'),q.x,q.y,r*.5,.72*al);
      if(n.imp>.55||n.label)sparkle(q.x,q.y,Math.max(1.6,r*.62),rgb,Math.min(.5,al*.34));
      if(liked){drawSprite(dot(rgb),q.x,q.y,r*7.6,Math.min(.95,(.22+hot*.26)*al*1.7));const ang=intro*.25+n.phase,rad=r*2.15;sparkle(q.x+Math.cos(ang)*rad,q.y+Math.sin(ang)*rad*.7,Math.max(1.4,r*.42),rgb,Math.min(.55,al*.45));}
      if(n.ping)n.ping*=.93;
      if(!selectedId&&n.label&&intro>3.1)labelFor(n,q,r);
      if(isHover&&!isSel)labelFor(n,q,r);
      ctx.globalAlpha=1;
    }
    if(newest&&intro>3){
      const e=intro-3,q=project(newest.x,newest.y,newest.z);
      if(q){const ps=q.s/REF,fl=Math.max(0,1-e/.5);if(fl>0){drawSprite(dot(newest.rgb),q.x,q.y,42*ps*(1.3-fl*.3),.85*fl*fl);drawSprite(dot(newest.rgb),q.x,q.y,26*ps,.55*fl);}
        const us=clamp(e/1.25,0,1);if(us>0&&us<1){const rr=(9+66*(1-Math.pow(1-us,2)))*ps,g2=ctx.createRadialGradient(q.x,q.y,rr*.62,q.x,q.y,rr);g2.addColorStop(0,'rgba(255,255,255,0)');g2.addColorStop(.72,'rgba('+newest.rgb+','+(.30*(1-us)).toFixed(3)+')');g2.addColorStop(1,'rgba('+newest.rgb+',0)');ctx.fillStyle=g2;ctx.beginPath();ctx.arc(q.x,q.y,rr,0,TAU);ctx.fill();}
      }
    }
  }

  function drawVignette(){
    ctx.globalCompositeOperation='source-over';
    const vg=ctx.createRadialGradient(W/2,H*.52,Math.min(W,H)*.26,W/2,H*.52,Math.max(W,H)*.80);
    vg.addColorStop(0,'rgba(0,0,0,0)');vg.addColorStop(.55,'rgba(1,1,4,.20)');vg.addColorStop(1,'rgba(1,1,4,.70)');
    ctx.fillStyle=vg;ctx.fillRect(0,0,W,H);
    const fg=ctx.createRadialGradient(W/2,H*.55,0,W/2,H*.55,Math.max(W,H)*.55);
    fg.addColorStop(0,'rgba(126,112,196,.055)');fg.addColorStop(.55,'rgba(96,84,168,.030)');fg.addColorStop(1,'rgba(0,0,0,0)');
    ctx.fillStyle=fg;ctx.fillRect(0,0,W,H);
  }

  function draw(){
    if(W<20||H<20)return;
    ctx.globalCompositeOperation='source-over';drawBackground();drawDust();
    ctx.globalCompositeOperation='lighter';drawParticles();drawCore();drawEdges();drawStars();drawVignette();
  }

  function hitTest(clientX,clientY){
    const x=clientX-cvRect.left,y=clientY-cvRect.top;
    let best=null,bd=Infinity;
    const all=[...stars,...(mode==='relations'?extraStars:[])];
    for(const n of all){const q=project(n.x,n.y,n.z);if(!q)continue;const d=(q.x-x)**2+(q.y-y)**2,rr=Math.max(15,n.size*2.2);if(d<rr*rr&&d<bd){bd=d;best=n;}}
    const cq=project(-.30,0,0);if(cq){const d=(cq.x-x)**2+(cq.y-y)**2;if(d<26*26&&d<bd)best=centerNode;}
    return best;
  }

  function loop(now){
    if(destroyed)return;
    frame=requestAnimationFrame(loop);
    if(!active||document.hidden)return;
    const dt=Math.min(.05,(now-last)/1000||.016);last=now;
    if(lastDraw&&now-lastDraw<32)return;
    lastDraw=now;
    if(!reduced()){intro=(now-introStart)/1000;if(!dragging)theta+=dt*.035;}else intro=6;
    const k=clamp(intro/4.2,0,1),ease=easeOutCubic(k);
    phiOff=Math.sin(intro*.85)*.11*(1-ease);
    dist=(13.5-4.3*ease)+(distGoal-9.2)*ease;
    cosT=Math.cos(theta);sinT=Math.sin(theta);cosP=Math.cos(phi+phiOff);sinP=Math.sin(phi+phiOff);
    const t=performance.now();draw();
    const ms=performance.now()-t;drawCount++;totalDrawMs+=ms;maxDrawMs=Math.max(maxDrawMs,ms);
  }

  function onPointerDown(e){
    dragging=true;lastPointer={x:e.clientX,y:e.clientY};downAt={x:e.clientX,y:e.clientY};canvas.classList.add('drag');try{canvas.setPointerCapture(e.pointerId);}catch{}
  }
  function onPointerMove(e){
    if(dragging&&lastPointer){const dx=e.clientX-lastPointer.x,dy=e.clientY-lastPointer.y;theta+=dx*.005;phi=clamp(phi+dy*.0035,-1.25,1.25);lastPointer={x:e.clientX,y:e.clientY};return;}
    const n=hitTest(e.clientX,e.clientY);
    if((n?.id??'')!==(hovered?.id??'')){hovered=n;canvas.style.cursor=n?'pointer':'grab';onHover(n);}
  }
  function endDrag(e){
    if(!dragging)return;dragging=false;canvas.classList.remove('drag');
    try{if(e&&e.pointerId!==undefined&&canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);}catch{}
    if(e&&downAt&&Math.hypot(e.clientX-downAt.x,e.clientY-downAt.y)<6){const n=hitTest(e.clientX,e.clientY);selectedId=n?.id??'';onSelect(n||null);}
    downAt=null;
  }
  function onWheel(e){e.preventDefault();if(intro<3.2)return;distGoal=clamp(distGoal*Math.exp(e.deltaY*.0011),3.4,20);lastDraw=0;}

  canvas.addEventListener('pointerdown',onPointerDown);
  canvas.addEventListener('pointermove',onPointerMove);
  canvas.addEventListener('pointerup',endDrag);
  canvas.addEventListener('pointercancel',endDrag);
  canvas.addEventListener('pointerleave',()=>{hovered=null;onHover(null);});
  canvas.addEventListener('wheel',onWheel,{passive:false});
  const observer=new ResizeObserver(resize);observer.observe(canvas);
  const themeObserver=new MutationObserver(()=>{lastDraw=0;});themeObserver.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme','class']});
  buildGalaxy();buildCloudFields();resize();
  requestAnimationFrame(loop);
  setTimeout(()=>{if(W<20||H<20)resize();},300);setTimeout(resize,1500);

  return {
    stats:()=>({nodes:stars.length,relations:extraStars.length,particles:[...buckets.values()].reduce((s,a)=>s+a.length,0),edges:edges.length,draws:drawCount,averageDrawMs:drawCount?totalDrawMs/drawCount:0,maxDrawMs}),
    setData,
    select(id){selectedId=id??'';if(selectedId&&!starById.has(selectedId)&&!extraById.has(selectedId)&&selectedId!==centerNode?.id)selectedId='';lastDraw=0;},
    mode(value){mode=value==='relations'?'relations':'galaxy';rebuild();lastDraw=0;},
    zoom(f){distGoal=clamp(distGoal/f,3.4,20);lastDraw=0;},
    reset(){theta=.5;phi=.30;distGoal=9.2;lastDraw=0;},
    rotate(value){auto=!!value;},
    replay(){started=true;replayIntro();lastDraw=0;},
    active(value){active=!!value;if(value){resize();last=performance.now();lastDraw=0;}},
    destroy(){destroyed=true;cancelAnimationFrame(frame);observer.disconnect();themeObserver.disconnect();}
  };
}
