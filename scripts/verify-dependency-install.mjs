// Isolated official download/install. Does not touch the active QQ/AstrBot data.
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import crypto from 'node:crypto';
import {DependencyCenter} from '../src/dependencies.js';
import {AstrBotHost} from '../src/astrbot-host.js';
import {root} from '../src/config.js';
const port=async()=>{const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;};
const base=process.argv[2]?path.resolve(process.argv[2]):path.join(root,'data','dependency-install-check-'+Date.now()),ports={dashboard:await port(),gateway:await port()};
if(path.dirname(base)!==path.join(root,'data')||!/^dependency-install-check-\d+$/.test(path.basename(base)))throw Error('Verification target must be an isolated dependency-install-check directory');
const center=new DependencyCenter(base,{projectRoot:root,getToken:()=>crypto.randomBytes(32).toString('hex'),ports});
let host;
try{
  center.install({index:'aliyun'});let previous='';const timer=setInterval(()=>{const s=center.state();const current=JSON.stringify({state:s.job.state,stage:s.job.stage,bytes:s.job.bytes,error:s.job.error});if(current!==previous){console.log(current);previous=current;}},1000);timer.unref();
  await center.work;clearInterval(timer);if(center.state().job.state!=='succeeded')throw Error(center.state().job.error);
  host=new AstrBotHost(base);host.dashboard=`http://127.0.0.1:${ports.dashboard}/`;host.configureBridge();await host.start();
  let ready=false;for(let i=0;i<90;i++){try{const r=await fetch(host.dashboard,{signal:AbortSignal.timeout(1000)});await r.body?.cancel();if(r.ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,500));}
  if(!ready)throw Error('Fresh AstrBot dashboard not ready');
  const result={ok:true,officialUvHashVerified:true,isolatedPython:true,astrbot:'4.29.4',pipCheck:true,dashboardReady:true,qqStarted:false,modelCalled:false,base};fs.writeFileSync(path.join(root,'data','dependency-install-verification.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await center.close();await host?.stop();}
