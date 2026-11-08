export async function waitForReaderReady(read,{isAlive=()=>true,now=Date.now,sleep=ms=>new Promise(r=>setTimeout(r,ms)),timeoutMs=12000}={}){
  const deadline=now()+timeoutMs;
  while(now()<deadline){
    if(!isAlive())throw Error('微信读取进程已退出');
    try{const status=await read();if(status.backend==='weflow-cli-nt'&&status.ownWxid&&!status.lastError)return status;}catch{}
    await sleep(Math.min(100,Math.max(0,deadline-now())));
  }
  throw Error('微信读取服务启动超时，请检查账号与读取组件');
}
