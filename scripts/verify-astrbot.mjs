import fs from 'node:fs';
import {PluginGateway} from '../src/plugin-gateway.js';
import {WebSocket} from 'ws';
import {normalize} from '../src/policy.js';
import {chatDefaults,policyFor} from '../src/config.js';
const settings=JSON.parse(fs.readFileSync('data/astrbot/data/cmd_config.json','utf8').replace(/^\uFEFF/,''));
const config={allowedUsers:['10'],allowedGroups:['20'],wakeWords:['小鱼'],followupSeconds:0,historyMessages:8,memoryChars:1600,defaults:{...chatDefaults,pluginsEnabled:true,pluginCommands:['helloworld','xyimage']},chats:{}};
const replies=[];let complete;
const gateway=new PluginGateway({token:settings.platform[0].ws_reverse_token,getAccount:()=> '99',policy:s=>policyFor(config,s),onebot:{connected:true,reply:async()=>{},action:async(action,params)=>{
  if(action==='get_login_info')return {user_id:99,nickname:'隔离小鱼'};
  if(action==='get_status')return {online:true,good:true};
  if(action==='get_version_info')return {app_name:'Xiaoyu-isolated-test',protocol_version:'v11'};
  if(action==='get_group_member_info')return {user_id:params.user_id,nickname:'隔离小鱼',card:'',role:'member'};
  if(['send_group_msg','send_private_msg'].includes(action)){replies.push({action,target:params.group_id??params.user_id,types:params.message.map(s=>s.type),text:params.message.filter(s=>s.type==='text').map(s=>s.data.text).join('')});complete?.();return {message_id:100+replies.length};}
  throw new Error('No real QQ connection in this verification');
}}});
const event=(command,id)=>({time:Math.floor(Date.now()/1000),post_type:'message',message_type:'group',sub_type:'normal',self_id:99,user_id:10,group_id:20,message_id:id,font:0,sender:{user_id:10,nickname:'隔离测试',card:'隔离测试',role:'member'},message:[{type:'at',data:{qq:'99'}},{type:'text',data:{text:'小鱼 /插件 '+command}}]});
try{gateway.start();await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('AstrBot WebSocket未就绪')),10000);gateway.socket.once('open',()=>{clearTimeout(timer);resolve();});gateway.socket.once('error',reject);});
  for(const [i,command]of ['helloworld','xyimage'].entries()){gateway.cancel();const waiting=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error(command+' 未收到插件回复')),20000);complete=()=>{clearTimeout(timer);resolve();};});await gateway.handle(normalize(event(command,i+1),config));await waiting;}
  if(!replies.some(r=>r.text.includes('Hello'))||!replies.some(r=>r.types.includes('image')))throw new Error('插件输出类型不符');
  fs.writeFileSync('data/astrbot-plugin-verification.json',JSON.stringify({date:new Date().toISOString(),realAstrBot:true,realQQ:false,modelCalls:0,replies},null,2));console.log('Real AstrBot official hello and local image fixture passed; no QQ/model calls.');
}finally{await gateway.stop();}
