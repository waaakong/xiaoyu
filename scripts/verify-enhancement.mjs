// Isolated AstrBot + chat_plus integration. Uses fake QQ and a fake model only.
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import crypto from 'node:crypto';
import {root} from '../src/config.js';
import {Store} from '../src/store.js';
import {Bridge} from '../src/bridge.js';
import {PluginGateway} from '../src/plugin-gateway.js';
import {PluginModelServer} from '../src/plugin-model-server.js';
import {AstrBotHost} from '../src/astrbot-host.js';
import {policyFor} from '../src/config.js';

const freePort=async()=>{const server=net.createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;await new Promise(r=>server.close(r));return port;};
const dir=path.join(root,'data','enhancement-fixture-'+Date.now()),botRoot=path.join(dir,'astrbot');fs.mkdirSync(path.join(botRoot,'data','plugins'),{recursive:true});fs.writeFileSync(path.join(botRoot,'.astrbot'),'');
const config=JSON.parse(fs.readFileSync(path.join(root,'data','astrbot','data','cmd_config.json'),'utf8').replace(/^\uFEFF/,'')),token=crypto.randomBytes(32).toString('hex');
config.dashboard={...config.dashboard,port:await freePort(),host:'127.0.0.1',username:'fixture',password:'',pbkdf2_password:'',jwt_secret:crypto.randomBytes(32).toString('hex'),totp:{enable:false}};
config.provider=[];config.provider_sources=[];config.admins_id=[];config.platform=[{id:'xiaoyu_fixture',type:'aiocqhttp',enable:true,ws_reverse_host:'127.0.0.1',ws_reverse_port:await freePort(),ws_reverse_token:token}];
config.plugin_set=['*'];config.inactivated_plugins=[];
config.pip_install_arg=`--no-index --no-deps --disable-pip-version-check --target "${path.join(dir,'fixture-dependencies').replaceAll('\\','/')}"`;
fs.writeFileSync(path.join(botRoot,'data','cmd_config.json'),JSON.stringify(config));
fs.cpSync(path.join(root,'data','astrbot','data','plugins','astrbot_plugin_group_chat_plus'),path.join(botRoot,'data','plugins','astrbot_plugin_group_chat_plus'),{recursive:true,filter:p=>!p.split(path.sep).includes('__pycache__')});
fs.cpSync(path.join(root,'examples','astrbot','xiaoyu_enhancement_test'),path.join(botRoot,'data','plugins','xiaoyu_enhancement_test'),{recursive:true});
const continuityTest=process.argv.includes('--continuity');
const policyConfig={allowedUsers:['10'],allowedGroups:['20'],admins:[],wakeWords:['小鱼'],followupSeconds:60,historyMessages:8,memoryChars:500,defaults:{pluginsEnabled:true,pluginMode:'enhanced',pluginCallLimit:3,autoSummary:false}};
const store=new Store(':memory:'),sent=[],modelCalls=[];
if(continuityTest){policyConfig.defaults.crossMemoryRead=true;policyConfig.defaults.crossMemoryWrite=true;store.savePersona({id:'default',name:'小鱼',category:'test',text:'你叫小鱼，自然简短聊天'});const run=crypto.randomUUID(),source=store.add('qq:99:private:10','user','私聊跨聊联调代号是海盐青柠','received',JSON.stringify({id:'10'}));store.tagTurn(source,'default',run,'小鱼');store.continuity.save({name:'fixture',owner:'10',personaId:'default',sourceScopes:['qq:99:private:10'],targetScopes:['qq:99:group:20']},s=>policyFor(policyConfig,s));}
const onebot={connected:true,reply:async(e,text)=>{sent.push({type:'core',text});return [{message_id:1}];},action:async(action,p)=>{if(action.startsWith('send_')){sent.push({type:'plugin',message:p.message});return {message_id:Math.floor(Math.random()*10000)};}if(action==='get_login_info')return {user_id:99,nickname:'小鱼'};if(action==='get_status')return {online:true,good:true};if(action==='get_version_info')return {app_name:'Fixture',protocol_version:'v11'};if(action==='get_group_info')return {group_id:20,group_name:'Fixture'};if(action==='get_group_member_info')return {user_id:p.user_id,nickname:'Fixture',role:'member'};return [];} };
const bridge=new Bridge({config:policyConfig,store,onebot,codex:{chat:async request=>{modelCalls.push({persona:request.persona,text:request.text,memory:request.memory});if(continuityTest&&!request.memory.includes('海盐青柠'))throw Error('增强模型未收到已授权私聊续聊内容');return {reply:request.persona.startsWith('你是当前聊天的辅助')?'yes':'小鱼增强测试成功',memories:[]};}},persona:'你叫小鱼，自然简短聊天',account:'99',log:console.log});
const gateway=new PluginGateway({url:`ws://127.0.0.1:${config.platform[0].ws_reverse_port}/ws`,token,onebot,getAccount:()=>99,policy:s=>policyFor(policyConfig,s),log:console.log});bridge.plugins=gateway;
const originalConnect=gateway.connect.bind(gateway);gateway.connect=()=>{originalConnect();gateway.socket?.on('error',e=>console.log('Fixture websocket: '+e.message));};
const server=new PluginModelServer(gateway),host=new AstrBotHost(dir);host.python=path.join(root,'data','astrbot-env','Scripts','python.exe');
let timer;
try{
  host.configureBridge();await server.start();await host.start({modelURL:server.url,modelToken:server.token});gateway.start();
  const logFile=path.join(dir,'astrbot-runtime.log');const start=Date.now();while(Date.now()-start<45000){if(gateway.state().connected&&fs.existsSync(logFile)&&fs.readFileSync(logFile,'utf8').includes('AstrBot started.'))break;gateway.connect();await new Promise(r=>setTimeout(r,500));}
  if(!gateway.state().connected)throw Error('Fixture AstrBot did not connect: '+dir);
  const event={time:Math.floor(Date.now()/1000),post_type:'message',sub_type:'normal',message_type:'group',self_id:99,user_id:10,group_id:20,message_id:1,sender:{user_id:10,nickname:'Fixture',role:'member'},message:[{type:'at',data:{qq:'99'}},{type:'text',data:{text:'辅助测试，请简短打招呼'}}],raw_message:'辅助测试，请简短打招呼'};
  if(continuityTest)event.message.find(m=>m.type==='text').data.text+='，还记得私聊的联调代号吗';
  await bridge.handle(event);await Promise.race([Promise.all([...bridge.queues.values()].map(q=>q.chain)),new Promise((r,j)=>{timer=setTimeout(()=>j(Error('Fixture pipeline timed out: '+dir)),35000);})]);clearTimeout(timer);
  if(modelCalls.length!==2||!modelCalls.some(c=>(c.persona+c.text).includes('XIAOYU_HOOK_SENTINEL'))||!sent.some(s=>s.message?.some(m=>m.type==='text'&&m.data.text.includes('[后处理已生效]')))||!sent.some(s=>s.type==='plugin'&&s.message.some(m=>m.type==='text'&&m.data.text.includes('小鱼增强测试成功')))||sent.some(s=>s.type==='core'))throw Error('Fixture response verification failed: '+JSON.stringify({modelCalls:modelCalls.map(c=>({sentinel:(c.persona+c.text).includes('XIAOYU_HOOK_SENTINEL'),personaChars:c.persona.length,textChars:c.text.length})),sent,gateway:gateway.state(),directory:dir}));
  const installs=JSON.parse(fs.readFileSync(path.join(botRoot,'installation-verification.json'),'utf8'));if(JSON.stringify(installs.order)!=='[1,2,0,3]'||!installs.lockReleased)throw Error('Installation lock recovery failed');
  const result={ok:true,privateContinuityVerified:continuityTest&&modelCalls.every(c=>c.memory.includes('海盐青柠')),realAstrBot:true,realChatPlus:true,fakeQq:true,fakeModel:true,modelCalls:modelCalls.length,pluginReplies:sent.length,duplicateCoreReplies:0,auxiliaryCallsVerified:true,promptInjectionVerified:true,responseDecorationVerified:true,sequentialPluginInstalls:3,failedInstallRecovery:true,directory:dir};fs.writeFileSync(path.join(root,'data','enhancement-fixture-verification.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{clearTimeout(timer);await gateway.stop();await bridge.stop();await host.stop();await server.stop();store.close();}
