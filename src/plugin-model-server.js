import http from 'node:http';
import crypto from 'node:crypto';

export function pluginModelInput(body){
  if(!body||typeof body.trace!=='string'||!/^[-a-f0-9]{36}$/.test(body.trace)||!['reply','aux'].includes(body.purpose))throw new Error('模型请求格式无效');
  const system=typeof body.system==='string'?body.system:'',prompt=typeof body.prompt==='string'?body.prompt:'';
  if(!Array.isArray(body.contexts))throw new Error('插件上下文格式无效：contexts必须为数组');
  const essential=system.length+prompt.length;
  if(essential>32000)throw new Error(`插件必要输入超出32000字符预算（系统提示${system.length}，当前问题${prompt.length}）；请缩短插件提示词或当前输入`);
  const messages=body.contexts.map(m=>{if(!m||!['user','assistant','system'].includes(m.role)||typeof m.content!=='string')throw new Error('仅支持纯文本插件上下文');return {role:m.role,content:m.content};});
  const contexts=[];let remaining=32000-essential,shortened=0;
  // Collapse adjacent duplicates only; repetition across different turns is meaningful.
  const unique=messages.filter((m,i)=>!i||m.role!==messages[i-1].role||m.content!==messages[i-1].content);
  for(let i=unique.length-1;i>=0&&remaining>0&&contexts.length<40;i--){
    const m=unique[i];
    if(m.content.length<=remaining){contexts.unshift(m);remaining-=m.content.length;}
    else {const marker='[较早内容已省略]\n';if(remaining>marker.length){let tail=m.content.slice(-(remaining-marker.length));if(tail.length&&/[\uDC00-\uDFFF]/.test(tail[0]))tail=tail.slice(1);contexts.unshift({role:m.role,content:marker+tail});shortened++;}break;}
  }
  if(messages.length!==contexts.length||shortened)console.info('[plugin-model-budget]',JSON.stringify({trace:body.trace,systemChars:system.length,promptChars:prompt.length,historyBefore:messages.length,historyAfter:contexts.length,shortened}));
  return {trace:body.trace,purpose:body.purpose,system,prompt,contexts};
}
export class PluginModelServer {
  constructor(gateway){this.gateway=gateway;this.token=crypto.randomBytes(32).toString('hex');this.server=null;this.url=null;}
  async start(){if(this.server)return;const server=http.createServer(async(req,res)=>{const json=(code,v)=>{res.writeHead(code,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(v));};const expected=Buffer.from(this.token),actual=Buffer.from(req.headers['x-xiaoyu-token']??'');if(req.headers.host!==new URL(this.url).host||req.headers.origin||actual.length!==expected.length||!crypto.timingSafeEqual(actual,expected)){json(403,{error:'模型桥接验证失败'});return;}if(req.method!=='POST'||!['/model','/complete'].includes(req.url)){json(404,{error:'无此接口'});return;}const controller=new AbortController();res.on('close',()=>{if(!res.writableEnded)controller.abort();});try{let size=0;const chunks=[];for await(const b of req){size+=b.length;if(size>192*1024)throw Error('请求过大');chunks.push(b);}const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));const result=req.url==='/model'?await this.gateway.callModel(body.trace,pluginModelInput(body),{signal:controller.signal}):this.gateway.complete(body.trace,{error:body.error===true});json(200,result);}catch(e){json(400,{error:e.message.slice(0,160)});}});await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});this.server=server;this.url='http://127.0.0.1:'+server.address().port;}
  async stop(){if(!this.server)return;const s=this.server;this.server=null;s.closeAllConnections();await new Promise(r=>s.close(r));}
}
