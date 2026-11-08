import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import path from 'node:path';

// Explicitly enabled, per-operation leases. The independent helper owns the
// 30-second restoration limit; the action is cancelled before that expires.
export class WeChatAccessibility {
  constructor({root,enabled,python,spawnImpl=spawn,audit=()=>{},timeoutMs=20000}){
    Object.assign(this,{root,enabled,python,spawnImpl,audit,timeoutMs});
    this.tail=Promise.resolve();this.active=new Set();this.closed=false;
  }
  run(proof,action){
    const task=this.tail.then(()=>this.operate(proof,action));
    this.tail=task.catch(()=>{});return task;
  }
  async operate(proof,action){
    if(this.closed)throw Error('微信控件适配已停止');
    if(this.fault)throw this.fault;
    if(!this.enabled())return action({signal:new AbortController().signal,adapted:false});
    if(proof?.client?.version!=='4.2.0.13'||!Number.isInteger(proof.identity?.clientPid)||proof.identity.clientPid<=0||proof.identity.version!==proof.client.version)throw Error('微信控件适配版本或实时账号证据无效');
    const child=this.spawnImpl(this.python(),['-B',path.join(this.root,'scripts','wechat-accessibility-test.py'),'--temporary-test'],{windowsHide:true,stdio:['pipe','pipe','pipe']});
    const controller=new AbortController();const lease={child,controller};this.active.add(lease);
    let readyResolve,readyReject,closedResolve,restoration,changed=false,mayChange=false,alreadyEnabled=false,error;
    const ready=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});
    const closed=new Promise(resolve=>{closedResolve=resolve;});
    const lines=createInterface({input:child.stdout});
    child.stderr?.on('data',()=>{});child.stdin.on('error',()=>{});
    const restore=()=>{if(!child.stdin.destroyed&&!child.stdin.writableEnded)child.stdin.end('{"restore":true}\n');};
    controller.signal.addEventListener('abort',restore,{once:true});
    lines.on('line',line=>{
      let row;try{row=JSON.parse(line);}catch{return;}
      if(row.type==='inspection'&&row.gate===1){alreadyEnabled=true;readyResolve();}
      if(row.type==='inspection'&&row.gate===0)mayChange=true;
      if(row.type==='phase'&&row.phase==='temporarily-enabled'){changed=true;readyResolve();}
      if(row.type==='restoration')restoration=row;
      if(row.type==='error'){error=String(row.code).slice(0,160);readyReject(Error('微信控件适配检查失败：'+error));}
    });
    child.once('error',()=>{error='HELPER_START_FAILED';readyReject(Error('微信控件适配进程无法启动'));closedResolve(-1);});
    child.once('close',code=>{
      if(!alreadyEnabled){controller.abort();readyReject(Error('微信控件适配提前结束'));}
      closedResolve(code);
    });
    const timer=setTimeout(()=>{controller.abort();readyReject(Error('微信控件操作超时，已请求恢复'));},this.timeoutMs);
    const abortPromise=new Promise((_,reject)=>controller.signal.addEventListener('abort',()=>reject(Error('微信控件操作已停止，投递结果需核对')),{once:true}));
    // Install the rejection handler before readiness to avoid an orphan rejection.
    abortPromise.catch(()=>{});
    let result,failure;
    try{
      child.stdin.write(JSON.stringify({pid:proof.identity.clientPid,executable:proof.client.executable,corePath:proof.client.core})+'\n');
      await ready;
      controller.signal.throwIfAborted();
      result=await Promise.race([action({signal:controller.signal,adapted:true}),abortPromise]);
    }catch(e){failure=e;}
    finally{
      clearTimeout(timer);restore();
      const code=await closed;lines.close();this.active.delete(lease);
      const restored=alreadyEnabled||restoration?.restored===true;
      this.audit({version:proof.client.version,changed,mayChange,restored:!!restored,observedBeforeRestore:restoration?.observedBeforeRestore,exit:code,error});
      if(mayChange&&!restored){this.fault=Error('微信控件状态恢复未确认，后续控件操作已阻止；请重启微信后重新核验，未自动重发');failure=this.fault;}
    }
    if(failure)throw failure;
    return result;
  }
  async close(){this.closed=true;for(const lease of this.active)lease.controller.abort();await this.tail;}
}
