export const starTypes={fixed:['固定','#c8bb8d'],fact:['事实','#9acbb9'],event:['经历','#d2a5a1'],note:['日记','#b9afd0'],topic:['知识','#93bad2'],plan:['约定','#ceb692'],person:['人物','#bfc3a7'],chat:['聊天','#91aeb9'],persona:['人格','#9ec8c6']};
const hash=s=>{let x=2166136261;for(const c of s)x=Math.imul(x^c.charCodeAt(0),16777619);return (x>>>0)/4294967296;};
export function createStarCanvas(canvas,{onSelect,onHover=()=>{}}){
  const ctx=canvas.getContext('2d'),motion=matchMedia('(prefers-reduced-motion: reduce)');
  let nodes=[],edges=[],points=[],selected='',mode='galaxy',yaw=-.15,pitch=.45,zoom=1,auto=false,dirty=true,last=0,frame,drag,active=false,W=1,H=1,hover='',drawCount=0,totalDrawMs=0,maxDrawMs=0;
  const invalidate=()=>dirty=true;
  function resize(){const r=canvas.getBoundingClientRect();W=r.width;H=r.height;const d=Math.min(devicePixelRatio||1,2);canvas.width=Math.max(1,Math.round(W*d));canvas.height=Math.max(1,Math.round(H*d));ctx.setTransform(d,0,0,d,0,0);invalidate();}
  const observer=new ResizeObserver(resize);observer.observe(canvas);
  const themeObserver=new MutationObserver(invalidate);themeObserver.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme','class']});
  function position(n){
    if(n.type==='center')return {x:0,y:0,z:0};
    const h=hash(n.id),i=Object.keys(starTypes).indexOf(n.type),a=h*Math.PI*2;
    if(n.type==='fixed')return {x:Math.cos(a)*53,y:Math.sin(a)*53,z:8};
    if(mode==='relations'){const angle=i*Math.PI*2/9,r=36+hash(n.id+'r')*50;return {x:Math.cos(angle)*205+Math.cos(a)*r,y:Math.sin(angle)*150+Math.sin(a)*r*.7,z:0};}
    const r=105+hash(n.id+'radius')*215,b=a+i*1.15;return {x:Math.cos(b)*r,y:Math.sin(b)*r*.68,z:(h-.5)*110};
  }
  function project(n){const p=position(n),cy=Math.cos(yaw),sy=Math.sin(yaw),cp=Math.cos(pitch),sp=Math.sin(pitch),x=p.x*cy+p.z*sy,z=-p.x*sy+p.z*cy,y=p.y*cp-z*sp,zz=p.y*sp+z*cp,k=720/(720+zz),s=Math.min(W/760,H/530)*zoom;return {x:W/2+x*k*s,y:H/2+y*k*s,k,z:zz,n};}
  function draw(t){
    frame=requestAnimationFrame(draw);if(!active||document.hidden||t-last<33||!dirty&&!auto)return;last=t;dirty=false;
    const drawStart=performance.now();if(auto&&!motion.matches&&!window.xyMotionDisabled?.())yaw+=.001;
    const light=document.documentElement.dataset.theme==='light',color=light?'#32675f':'#d4ebe4';ctx.clearRect(0,0,W,H);
    for(let i=0;i<125;i++){ctx.fillStyle=light?'#44687518':'#ccedee20';ctx.beginPath();ctx.arc(hash('dust'+i)*W,hash('dusty'+i)*H,.5,0,Math.PI*2);ctx.fill();}
    points=nodes.map(project);const byId=new Map(points.map(p=>[p.n.id,p]));
    if(mode==='galaxy'){for(let arm=0;arm<3;arm++){ctx.beginPath();for(let i=0;i<100;i++){const a=i*.033+arm*2.094,r=i*3.3,s=Math.min(W/760,H/530)*zoom,x=W/2+Math.cos(a)*r*s,y=H/2+Math.sin(a)*r*.5*s;i?ctx.lineTo(x,y):ctx.moveTo(x,y);}ctx.lineWidth=12;ctx.strokeStyle=light?'#40776b05':'#a9d3ca05';ctx.stroke();}}
    const neighbors=new Set([selected]);for(const e of edges)if(e.a===selected||e.b===selected){neighbors.add(e.a);neighbors.add(e.b);}
    for(const e of edges){const a=byId.get(e.a),b=byId.get(e.b);if(!a||!b)continue;const focused=e.a===selected||e.b===selected;if(!focused&&nodes.length>200)continue;ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.lineWidth=focused?1:.6;ctx.strokeStyle=focused?(light?'#337e6f80':'#b6e6d580'):(light?'#41696c22':'#9cc2c41c');ctx.stroke();}
    const labels=[];
    for(const p of [...points].sort((a,b)=>b.z-a.z)){const n=p.n,focus=n.id===selected||n.id===hover,root=n.type==='center',r=root?10:focus?5:['fixed','person','persona'].includes(n.type)?3.5:2.3,c=root?color:starTypes[n.type]?.[1]??color;
      ctx.globalAlpha=selected&&!neighbors.has(n.id)&&!focus ? .65 : 1;ctx.fillStyle=c;ctx.shadowBlur=focus?14:root?18:3;ctx.shadowColor=c;
      if(root){ctx.save();ctx.translate(p.x,p.y);ctx.scale(p.k,p.k);ctx.strokeStyle=c;ctx.lineWidth=1.8;ctx.beginPath();ctx.ellipse(-3,0,10,6,0,0,Math.PI*2);ctx.moveTo(6,0);ctx.lineTo(15,-7);ctx.lineTo(15,7);ctx.closePath();ctx.stroke();ctx.beginPath();ctx.arc(-8,-1,1,0,Math.PI*2);ctx.fill();ctx.restore();}else{ctx.beginPath();ctx.arc(p.x,p.y,Math.max(1,r*p.k),0,Math.PI*2);ctx.fill();}ctx.shadowBlur=0;ctx.globalAlpha=1;
      if(focus){ctx.strokeStyle=c;ctx.beginPath();ctx.arc(p.x,p.y,10*p.k,0,Math.PI*2);ctx.stroke();}
      if(root||focus||nodes.length<65&&['person','persona','chat'].includes(n.type))labels.push({...p,priority:focus?3:root?2:1});
    }
    const boxes=[];for(const p of labels.sort((a,b)=>b.priority-a.priority)){const title=p.n.title.length>17?p.n.title.slice(0,16)+'…':p.n.title;ctx.font=(p.n.type==='center'?'600 13px':'11px')+' "Microsoft YaHei",sans-serif';ctx.textAlign='center';const w=ctx.measureText(title).width+10;
      for(const dy of [25,43,-18]){const b={x:p.x-w/2,y:p.y+dy-12,w,h:17};if(b.x<4||b.x+w>W-4||b.y<5||b.y+17>H-5||boxes.some(a=>b.x<a.x+a.w&&b.x+w>a.x&&b.y<a.y+a.h&&b.y+17>a.y))continue;boxes.push(b);ctx.fillStyle=color;ctx.fillText(title,p.x,p.y+dy);break;}
    }
    const drawMs=performance.now()-drawStart;drawCount++;totalDrawMs+=drawMs;maxDrawMs=Math.max(maxDrawMs,drawMs);
  }
  function hit(e){const r=canvas.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top;return points.map(p=>({n:p.n,d:Math.hypot(p.x-x,p.y-y)})).filter(p=>p.d<14).sort((a,b)=>a.d-b.d)[0]?.n;}
  canvas.addEventListener('pointerdown',e=>{drag={x:e.clientX,y:e.clientY,distance:0};canvas.setPointerCapture(e.pointerId);});
  canvas.addEventListener('pointermove',e=>{if(drag){const dx=e.clientX-drag.x,dy=e.clientY-drag.y;drag.distance+=Math.abs(dx)+Math.abs(dy);yaw+=dx*.004;pitch=Math.max(-.85,Math.min(.85,pitch+dy*.004));drag.x=e.clientX;drag.y=e.clientY;invalidate();}else{const n=hit(e);if(hover!==n?.id){hover=n?.id??'';canvas.style.cursor=n?'pointer':'grab';onHover(n);invalidate();}}});
  canvas.addEventListener('pointerup',e=>{if(drag?.distance<5){const n=hit(e);if(n)onSelect(n);}drag=null;});
  canvas.addEventListener('pointercancel',()=>drag=null);canvas.addEventListener('pointerleave',()=>{hover='';onHover(null);invalidate();});
  canvas.addEventListener('wheel',e=>{e.preventDefault();zoom=Math.max(.5,Math.min(3,zoom*Math.exp(-e.deltaY*.001)));invalidate();},{passive:false});
  canvas.addEventListener('keydown',e=>{if(['ArrowLeft','ArrowRight'].includes(e.key)&&nodes.length){e.preventDefault();const i=nodes.findIndex(n=>n.id===selected);onSelect(nodes[(i+(e.key==='ArrowRight'?1:-1)+nodes.length)%nodes.length]);}if(['+','=','-'].includes(e.key)){e.preventDefault();zoomBy(e.key==='-' ? .85 : 1.15);}});
  function zoomBy(f){zoom=Math.max(.5,Math.min(3,zoom*f));invalidate();}
  frame=requestAnimationFrame(draw);
  return {stats:()=>({nodes:nodes.length,edges:edges.length,draws:drawCount,averageDrawMs:drawCount?totalDrawMs/drawCount:0,maxDrawMs}),setData(value){nodes=value.nodes;edges=value.edges;invalidate();},select(id){selected=id??'';invalidate();},mode(value){mode=value;yaw=value==='relations'?0:-.15;pitch=value==='relations'?0:.45;invalidate();},zoom:zoomBy,reset(){yaw=mode==='relations'?0:-.15;pitch=mode==='relations'?0:.45;zoom=1;invalidate();},rotate(value){auto=value;invalidate();},active(value){active=value;if(value)resize();else{hover='';drag=null;}},destroy(){cancelAnimationFrame(frame);observer.disconnect();themeObserver.disconnect();}};
}
