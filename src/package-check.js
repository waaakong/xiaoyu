import fs from 'node:fs';
import path from 'node:path';
import {startGui} from './gui.js';
import {Runtime} from './runtime.js';
import {Store} from './store.js';
import {root,loadConfig} from './config.js';
import {nativeExecutable} from './native-build.js';

let gui;
try{
  const runtime=new Runtime({store:new Store(':memory:')});
  gui=await startGui({open:false,autoConnect:false,runtime});
  const headers={'x-session-token':gui.token};
  const home=await fetch(gui.origin),state=await(await fetch(gui.origin+'/api/state',{headers})).json();
  const catalog=await(await fetch(gui.origin+'/api/catalog',{headers})).json();
  const serviceModule=await fetch(gui.origin+'/services.js');
  const dependencyModule=await fetch(gui.origin+'/dependencies.js');if(!dependencyModule.ok||!state.dependencies)throw Error('依赖中心模块缺失');
  const providerAdapterPresent=fs.existsSync(path.join(root,'integrations','astrbot','xiaoyu_provider.py'))&&fs.existsSync(path.join(root,'scripts','run-astrbot.py'));
  if(!serviceModule.ok||state.integrations.services.config.enabled||!providerAdapterPresent)throw new Error('统一服务模块缺失或发行包预设了自动启动');
  if(!home.ok||!fs.existsSync(nativeExecutable())||state.codex||state.running||catalog.personas.length<3)throw new Error('桌面包自检未通过');
  const config=loadConfig();
  if(config.allowedUsers.length||config.allowedGroups.length)throw new Error('发行包不应预先授权聊天');
  fs.writeFileSync(path.join(root,'data','package-check.json'),JSON.stringify({ok:true,node:process.version,platform:process.platform,arch:process.arch,version:state.version,personas:catalog.personas.map(p=>p.name),qqStarted:false,modelCalled:false,uiServed:home.ok,windowExecutablePresent:true,serviceModuleServed:true,serviceAutostart:false,providerAdapterPresent,dependencyModuleServed:true},null,2));
}catch(e){console.error(e.message);process.exitCode=1;}finally{await gui?.close();}
