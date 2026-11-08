import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {root} from './config.js';
import {inspectWeChat} from './wechat-client.js';
import {WeChatNativeClient} from './wechat-native.js';
const exec=promisify(execFile),read=file=>JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
const hash=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');

export async function ensureWeChatNative(backend,{reader}){
  const manager=backend.manager,client=await inspectWeChat(manager.config.executable);
  if(client.version!=='4.2.0.13')throw Error('WECHAT_NATIVE_VERSION_UNSUPPORTED');
  const directory=path.join(root,'data','wechat-native-research');
  const localBuild=path.join(directory,'build'),mediaBuild=path.join(directory,'build-media'),hasMedia=fs.existsSync(path.join(mediaBuild,'validation.json'));
  const mentionBuild=path.join(directory,'build-mentions'),hasMention=fs.existsSync(path.join(mentionBuild,'validation.json'))&&read(path.join(mentionBuild,'validation.json')).mentionValidated===true;
  const build=hasMention?mentionBuild:hasMedia?mediaBuild:fs.existsSync(path.join(localBuild,'manifest.json'))?localBuild:path.join(root,'integrations','wechat','native','bundle');
  const manifestFile=path.join(build,'manifest.json'),validationFile=hasMedia||hasMention?path.join(build,'validation.json'):fs.existsSync(path.join(directory,'self-test-result.json'))?path.join(directory,'self-test-result.json'):path.join(build,'validation.json');
  if(!fs.existsSync(manifestFile)||!fs.existsSync(validationFile))throw Error('WECHAT_NATIVE_NOT_PREPARED：尚未准备并实测此版本原生组件');
  const manifest=read(manifestFile),validation=read(validationFile);
  const mediaMask=validation.mediaMask??0;if(![0,1,3,19].includes(mediaMask)||mediaMask&&manifest.nativeProtocol!==2||mediaMask===19&&(!manifest.mentionsExperimental||validation.mentionValidated!==true))throw Error('WECHAT_NATIVE_MEDIA_NOT_VALIDATED');
  if(validation.confirmed!==true||validation.target!=='filehelper'||validation.nativeDll!==manifest.dllSha256||
     hash(path.join(build,'XiaoyuWechatNative.dll'))!==manifest.dllSha256||hash(client.core)!==manifest.coreSha256)throw Error('WECHAT_NATIVE_BUILD_MISMATCH');
  const identity=await backend.verifyIdentity({client,reader});
  const transport=new WeChatNativeClient(()=>manager.config);
  const sessionFile=path.join(directory,'session.json');
  try{const health=await transport.verify({accountDirectory:reader.accountDirectory});const owned=read(sessionFile);if(health.pid===identity.clientPid&&owned.dllSha256===manifest.dllSha256&&(health.mediaMask??0)===mediaMask&&(mediaMask!==19||health.nativeMentionSend===true))return health;}catch{}
  if(fs.existsSync(sessionFile)){
    const existing=read(sessionFile);
    if(existing.pid===identity.clientPid&&existing.loaded&&!existing.stopped)throw Error('WECHAT_NATIVE_SESSION_UNCERTAIN：已有组件会话未就绪，未重复加载');
  }
  await exec(backend.paths().python,['-B',path.join(root,'scripts','load-wechat-native.py'),'--pid',String(identity.clientPid),'--account-directory',reader.accountDirectory,'--limit','100000','--build-dir',build,'--media-mask',String(mediaMask),'--media-root',path.join(directory,'outgoing')],{cwd:root,windowsHide:true,timeout:45000,maxBuffer:32000});
  const session=read(sessionFile);
  if(!session.healthVerified||session.pid!==identity.clientPid||session.dllSha256!==manifest.dllSha256)throw Error('WECHAT_NATIVE_LOAD_NOT_VERIFIED');
  Object.assign(manager.config,{hookUrl:'http://127.0.0.1:'+session.port,hookToken:session.token});
  fs.writeFileSync(manager.file+'.tmp',JSON.stringify(manager.config),{mode:0o600});fs.renameSync(manager.file+'.tmp',manager.file);
  return transport.verify({accountDirectory:reader.accountDirectory});
}
