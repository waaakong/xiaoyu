import {Runtime} from './runtime.js';
const runtime=new Runtime();
try{await runtime.start();console.log('QQ 接收服务已启动。等待 NapCat 连接，联系人授权在可视化窗口配置。');let stopping=false;for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{if(stopping)return;stopping=true;await runtime.close();process.exit(0);});}catch(e){console.error(e.message);await runtime.close();process.exitCode=1;}
