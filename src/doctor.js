import {loadConfig} from './config.js';
import {Codex,safetyConfig} from './codex.js';
const c=loadConfig(),codex=new Codex(c);
try{
  await codex.start();console.log('App Server 初始化成功。');
  const auth=await codex.request('account/read',{refreshToken:false});
  console.log(auth.account?'已复用本机 Codex 认证，无需单独登录。':'未检测到标准账号；检查本机 Codex 的模型提供商配置。');
  const {thread}=await codex.request('thread/start',{ephemeral:true,cwd:c.workspace,sandbox:'read-only',approvalPolicy:'on-request',environments:[],config:codex.threadConfig});
  console.log('只读临时聊天线程创建成功（未调用模型）。');
  await codex.request('thread/unsubscribe',{threadId:thread.id});
  console.log(`QQ 接收地址 ws://127.0.0.1:${c.port}/onebot；私聊白名单 ${c.allowedUsers.length}，群白名单 ${c.allowedGroups.length}。`);
}catch(e){console.error(e.message);process.exitCode=1;}finally{codex.stop();}
