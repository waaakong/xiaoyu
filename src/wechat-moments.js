import {MomentsDraftWorkflow} from './moments-draft-workflow.js';
import {MomentsNativeService} from './moments-native-service.js';
import {MomentsPublisher} from './moments-publish.js';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import http from 'node:http';
import {momentsPacket,MOMENTS_CORE_SHA,sha256,parseMomentsObject,parseTimelineComments} from './wechat-moments-protocol.js';
import {publishMomentUi} from './wechat-moments-ui.js';
import {MomentsImages} from './moments-images.js';
import {MomentsComments} from './moments-comments.js';
import {beijingDate,nextPlanTime,planWindow} from './moments-plan.js';


export class MomentsClient {
  constructor(session){if(!session||!Number.isInteger(session.pid)||!Number.isInteger(session.port)||session.port<1024||session.port>65535||!/^[a-f0-9]{64}$/.test(session.token??'')||!/^[a-f0-9]{64}$/.test(session.approvedHash??''))throw Error('朋友圈原生组件会话无效');this.session=session;}
  request(route,body){return new Promise((resolve,reject)=>{const req=http.request({hostname:'127.0.0.1',port:this.session.port,path:route,method:body?'POST':'GET',timeout:11000,headers:{Authorization:'Bearer '+this.session.token,...(body?{'Content-Type':'application/octet-stream','Content-Length':body.length}:{})}},res=>{let data='';res.on('data',b=>{data+=b;if(data.length>(route==='/object'?132000:8192))res.destroy(Error('朋友圈组件返回过大'));});res.on('error',reject);res.on('end',()=>{try{if(res.statusCode!==200)throw Error('朋友圈组件拒绝请求：'+res.statusCode);resolve(JSON.parse(data));}catch(e){reject(e);}});});req.on('error',reject);req.on('timeout',()=>req.destroy(Error('朋友圈请求超时，结果需核对，不自动重试')));req.end(body);});}
  async health(){const h=await this.request('/health');if(h.integration!=='XiaoyuMoments-1'||h.offlineTest!==false||h.verified!==true||h.pid!==this.session.pid||h.accountDirectory!==this.session.accountDirectory||h.limit!==1)throw Error('朋友圈原生组件身份未核验');return h;}
  async submit(packet){packet=Buffer.from(packet);if(sha256(packet)!==this.session.approvedHash)throw Error('正文不属于此次已加载组件的明确授权范围');await this.health();const r=await this.request('/submit',packet);if(r.id!==packet.subarray(4,40).toString('ascii'))throw Error('朋友圈回执标识不匹配');return r;}
  result(){return this.request('/result');}
  object(){return this.request('/object');}
}

// Per-WeChat-account DB; does not read QQ's drafts, memory, diary or cookies.
export class WeChatMoments {
  constructor(runtime,{now=Date.now,client,publishUi=publishMomentUi,verifyPublish}={}){this.runtime=runtime;this.db=runtime.store.db;this.now=now;this.clientOverride=client;this.publishUi=publishUi;this.busy=false;this.closed=false;this.planTimer=null;this.planRun=null;this.planAttempts=0;this.planAttemptDate=null;this.images=new MomentsImages(runtime,{now});this.nativeComments=new MomentsNativeService(runtime,{now});this.publisher=new MomentsPublisher(runtime,{now,publish:publishUi,snapshot:()=>this.nativeComments.publicationSnapshot(),verify:verifyPublish});this.comments=new MomentsComments(runtime,{now,readComments:(_manager,options)=>this.nativeComments.readComments(options),replyComment:(m,p)=>this.nativeComments.replyComment(m,p),readReceipt:t=>this.nativeComments.readReceipt(t),transportReady:()=>this.nativeComments.snapshot()});this.imagesReady=false;
    this.db.exec(`CREATE TABLE IF NOT EXISTS moments_drafts(id TEXT PRIMARY KEY,account TEXT,text TEXT,visibility TEXT,status TEXT,created INTEGER,updated INTEGER);
      CREATE TABLE IF NOT EXISTS moments_sources(id TEXT PRIMARY KEY,scope TEXT,personaId TEXT,date TEXT,personaHash TEXT,diaryHash TEXT,diaryRefs TEXT);
      CREATE TABLE IF NOT EXISTS moments_proposals(id TEXT PRIMARY KEY,draftId TEXT,hash TEXT,packet BLOB,created INTEGER);
      CREATE TABLE IF NOT EXISTS moments_confirmations(token TEXT PRIMARY KEY,proposalId TEXT,expires INTEGER,used INTEGER DEFAULT 0);
      CREATE TABLE IF NOT EXISTS moments_operations(id TEXT PRIMARY KEY,draftId TEXT,proposalId TEXT,status TEXT,result TEXT,created INTEGER);
      CREATE TABLE IF NOT EXISTS moments_model_jobs(id TEXT PRIMARY KEY,scope TEXT,created INTEGER,estimate INTEGER,usage TEXT,status TEXT);
      CREATE TABLE IF NOT EXISTS moments_plan(id INTEGER PRIMARY KEY CHECK(id=1),enabled INTEGER DEFAULT 0,scope TEXT,personaId TEXT,startHour INTEGER DEFAULT 9,endHour INTEGER DEFAULT 22,visibility TEXT DEFAULT 'private',autoIllustrate INTEGER DEFAULT 1,maxImages INTEGER DEFAULT 1,lastDate TEXT,lastAt INTEGER,lastStatus TEXT,lastError TEXT,nextAt INTEGER,updated INTEGER);`);
    this.workflow=new MomentsDraftWorkflow(this);this.workflow.invalidateStaleReviews();
    for(const sql of ['ALTER TABLE moments_plan ADD COLUMN autoIllustrate INTEGER DEFAULT 1','ALTER TABLE moments_plan ADD COLUMN maxImages INTEGER DEFAULT 1','ALTER TABLE moments_sources ADD COLUMN diaryRefs TEXT'])try{this.db.exec(sql);}catch{}
    this.db.exec("UPDATE moments_operations SET status='unknown' WHERE status='attempting'; UPDATE moments_drafts SET status='unknown' WHERE status='attempting'; UPDATE moments_model_jobs SET status='interrupted' WHERE status='running'");
    this.armPlan();
  }
  account(){const a=this.runtime.manager?.config.account;if(this.runtime.platform!=='wechat'||!/^wxid_[A-Za-z0-9_]{1,100}$/.test(a??''))throw Error('请先核验角色微信账号');return a;}
  ensureImages(){if(this.imagesReady)return Promise.resolve();if(this.imagesSeeding)return this.imagesSeeding;this.imagesSeeding=(async()=>{try{await this.images.prepare();this.imagesReady=true;}catch(e){this.runtime.log?.('朋友圈图库初始化失败：'+String(e.message??e));}finally{this.imagesSeeding=null;}})();return this.imagesSeeding;}
  directory(){return path.join(this.runtime.manager.dataDir,'wechat-moments-research');}
  async client(){if(this.clientOverride)return this.clientOverride;const read=p=>JSON.parse(fs.readFileSync(p,'utf8')),base=this.directory(),s=read(path.join(base,'session.json')),m=read(path.join(base,'build/manifest.json'));
    if(s.healthVerified!==true||s.wxid!==this.account()||!s.accountDirectory.startsWith(s.wxid+'_')||m.offlineTest!==false||m.coreSha256!==MOMENTS_CORE_SHA||m.dllSha256!==s.dllSha256||sha256(fs.readFileSync(s.dllPath))!==s.dllSha256)throw Error('朋友圈实验组件尚未按具体文件加载核验');
    const c=new MomentsClient(s);await c.health();return c;}
  async readNativeComments(){
    const client=await this.client();
    const response=await client.object();
    if(!response||typeof response.protobufHex!=='string')throw Error('朋友圈只读组件没有返回对象详情');
    const object=parseMomentsObject(Buffer.from(response.protobufHex,'hex'));
    if(!object.accepted)throw Error('朋友圈对象详情未通过服务端校验');
    if(object.username!==this.account())throw Error('朋友圈对象不属于当前微信账号');
    return {objectId:object.objectId,username:object.username,comments:object.commentRowsPresent?object.comments:parseTimelineComments(object.timeline)};
  }
  async dashboard(){await this.nativeComments.refresh();let native={connected:false,message:'原生组件尚未加载；草稿只保存在本机'};try{const c=await this.client();native={connected:true,...await c.health(),proposalId:c.session?.proposalId,message:c.session?.operation==='detail'?'只读验收会话；不允许发布新动态':'单条授权原生文字实验；仍需核对实际发布结果'};}catch(e){native.message=e.code==='ENOENT'?'原生组件尚未加载；草稿只保存在本机':e.message;}
    await this.ensureImages();
    let images={total:0,items:[]},comments={policy:this.comments.policy(),posts:[],comments:[],counts:{posts:0,comments:0,pending:0}};
    try{images=this.images.dashboard();}catch(e){images={total:0,items:[],error:String(e.message??e)};}
    try{comments=this.comments.dashboard();}catch(e){comments={...comments,error:String(e.message??e)};}
    return {account:this.runtime.manager?.config.account??null,native,automatic:true,plan:this.plan(),capabilities:{text:'ui-automation',images:true,video:true,audience:true,comments:{read:true,autoReply:this.comments.transportReady().ready===true,deliveryVerified:false},concurrentPublish:true},images,comments,publishJobs:this.publisher.jobs(),reviews:this.db.prepare('SELECT r.* FROM moments_ui_reviews r JOIN moments_drafts d ON d.id=r.draftId WHERE d.account=? ORDER BY r.created DESC LIMIT 100').all(this.account()),drafts:this.db.prepare('SELECT * FROM moments_drafts ORDER BY updated DESC LIMIT 100').all(),operations:this.db.prepare('SELECT * FROM moments_operations ORDER BY created DESC LIMIT 100').all(),generationJobs:this.db.prepare('SELECT * FROM moments_model_jobs ORDER BY created DESC LIMIT 50').all()};}
  registerUiPost(body,result){
    if(result?.published===true){
      const plan=this.plan();
      try{this.comments.registerPost({text:String(body.text??''),media:Array.isArray(body.media)?body.media:[],privacy:body.privacy==='public'?'public':'private',personaId:this.comments.policy().defaultPersonaId||plan.personaId||null,objectId:result.receipt?.objectId,ownerVerified:!!result.receipt?.verified,source:'ui'});}catch(e){this.runtime.log?.('朋友圈已发布，但评论追踪登记失败：'+String(e.message??e));}
      void this.comments.sync().catch(e=>this.runtime.log?.('朋友圈评论同步失败：'+String(e.message??e)));
    }
  }
  cancelComposition(body){return this.workflow.cancel(body.reviewId);}
  saveComposition(body){return this.workflow.save(body);}
  reviewComposition(body){return this.workflow.review(body.draftId);}
  publishComposition(body){return this.workflow.publish(body.reviewId);}
  loadComposition(body){return this.workflow.composition(body.draftId);}
  async publish(body={}){
    const result=await this.publisher.execute(body);
    this.registerUiPost(body,result);
    return result;
  }
  plan(){const d={enabled:false,scope:'',personaId:'',startHour:9,endHour:22,visibility:'private',autoIllustrate:true,maxImages:1,lastDate:null,lastAt:null,lastStatus:null,lastError:null,nextAt:null};const r=this.db.prepare('SELECT * FROM moments_plan WHERE id=1').get();return r?{...d,...r,enabled:r.enabled===1,autoIllustrate:r.autoIllustrate!==0,maxImages:Number(r.maxImages??1)}:d;}
  savePlan(plan){const p={...this.plan(),...plan};this.db.prepare('INSERT INTO moments_plan(id,enabled,scope,personaId,startHour,endHour,visibility,autoIllustrate,maxImages,lastDate,lastAt,lastStatus,lastError,nextAt,updated) VALUES(1,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET enabled=excluded.enabled,scope=excluded.scope,personaId=excluded.personaId,startHour=excluded.startHour,endHour=excluded.endHour,visibility=excluded.visibility,autoIllustrate=excluded.autoIllustrate,maxImages=excluded.maxImages,lastDate=excluded.lastDate,lastAt=excluded.lastAt,lastStatus=excluded.lastStatus,lastError=excluded.lastError,nextAt=excluded.nextAt,updated=excluded.updated').run(p.enabled?1:0,p.scope||'',p.personaId||'',p.startHour,p.endHour,p.visibility==='public'?'public':'private',p.autoIllustrate?1:0,p.maxImages,p.lastDate??null,p.lastAt??null,p.lastStatus??null,p.lastError??null,p.nextAt??null,this.now());return this.plan();}
  configurePlan(body={}){
    const enabled=body.enabled===true||body.enabled==='true'||body.enabled===1||body.enabled==='1';
    const scope=String(body.scope??'').trim(),personaId=String(body.personaId??'').trim();
    const startHour=Number(body.startHour),endHour=Number(body.endHour);
    if(!Number.isInteger(startHour)||!Number.isInteger(endHour)||startHour<0||endHour>24||startHour>=endHour)throw Error('随机时间窗口应为同一天内的开始/结束小时');
    const visibility=body.visibility==='public'?'public':'private';
    const old=this.plan();
    const autoIllustrate=body.autoIllustrate===undefined?old.autoIllustrate:body.autoIllustrate===true||body.autoIllustrate==='true'||body.autoIllustrate===1||body.autoIllustrate==='1';
    const maxImages=Number(body.maxImages??old.maxImages);
    if(!Number.isInteger(maxImages)||maxImages<0||maxImages>9)throw Error('每次自动配图应为 0—9 张');
    if(enabled){
      if(!scope||!personaId)throw Error('请选择微信私聊人格来源');
      this.runtime.notebook.assert(scope,personaId);
      if(this.runtime.manager?.config?.foregroundCompatibility!==true)throw Error('请先在微信接入中开启控件适配');
    }
    const now=this.now(),today=beijingDate(now);
    const nextAt=enabled?nextPlanTime({now,startHour,endHour,skipToday:old.lastDate===today}):null;
    return this.savePlan({...old,enabled,scope,personaId,startHour,endHour,visibility,autoIllustrate,maxImages,nextAt,lastError:enabled?null:old.lastError});
  }
  armPlan(){
    clearTimeout(this.planTimer);this.planTimer=null;
    if(this.closed)return;
    const p=this.plan();if(!p.enabled)return;
    const blocked=this.db.prepare("SELECT status FROM moments_plan_runs WHERE account=? AND date=? AND status IN ('unknown','published')").get(this.runtime.manager?.config?.account??'',beijingDate(this.now()));
    if(blocked){const nextAt=nextPlanTime({now:this.now(),startHour:p.startHour,endHour:p.endHour,skipToday:true});if(!p.nextAt||p.nextAt<=this.now()){p.nextAt=nextAt;this.savePlan({nextAt});}}
    let at=Number.isInteger(p.nextAt)?p.nextAt:null;
    if(at===null||at<=this.now()){at=nextPlanTime({now:this.now(),startHour:p.startHour,endHour:p.endHour,skipToday:p.lastDate===beijingDate(this.now())});this.savePlan({nextAt:at});}
    const delay=Math.max(1000,Math.min(at-this.now(),0x7fffffff));
    this.planTimer=setTimeout(()=>{this.planTimer=null;void this.runPlan().catch(e=>this.runtime.log?.('朋友圈计划失败：'+e.message));},delay);
    this.planTimer.unref?.();
  }
  async runPlan(){
    if(this.closed)return null;
    if(this.planRun)return this.planRun;
    const plan=this.plan();if(!plan.enabled)return null;
    const now=this.now(),today=beijingDate(now);
    const account=this.account(),saved=this.db.prepare('SELECT * FROM moments_plan_runs WHERE account=? AND date=?').get(account,today);
    if(saved&&['unknown','published'].includes(saved.status))return {status:saved.status,skipped:true};
    if(plan.lastDate===today){this.armPlan();return null;}
    if(this.planAttemptDate!==today){this.planAttemptDate=today;this.planAttempts=0;}
    this.planRun=(async()=>{
      let publishStarted=false;
      try{
        const draft=saved?.draftId?{id:saved.draftId}:await this.generate({scope:plan.scope,personaId:plan.personaId,theme:'',autonomous:true,autoIllustrate:plan.autoIllustrate,maxImages:plan.maxImages});
        if(this.closed)throw Error('朋友圈计划已停止');
        const row=this.db.prepare('SELECT text FROM moments_drafts WHERE id=?').get(draft.id);
        if(!row?.text)throw Error('朋友圈草稿为空');
        const media=this.images.draftMedia(draft.id).map(m=>m.path),payload=saved?.payload?JSON.parse(saved.payload):{text:row.text,media,privacy:plan.visibility,publish:true};
        if(this.account()!==account||this.plan().scope!==plan.scope||this.plan().personaId!==plan.personaId||!this.plan().enabled)throw Error('计划权限或账号已改变，未提交');
        this.db.prepare("INSERT INTO moments_plan_runs VALUES(?,?,?,?,'ready',NULL) ON CONFLICT(account,date) DO UPDATE SET status='ready'").run(account,today,draft.id,JSON.stringify(payload));
        publishStarted=true;const result=await this.publisher.execute(payload,{source:'plan',draftId:draft.id,planDate:today});
        if(result?.published!==true){this.db.prepare("UPDATE moments_plan_runs SET status='unknown',error=? WHERE account=? AND date=?").run(result.notice??'结果待核对',account,today);this.savePlan({lastStatus:'unknown',lastError:result.notice??'结果待核对，禁止自动重发',nextAt:nextPlanTime({now:this.now(),startHour:plan.startHour,endHour:plan.endHour,skipToday:true})});return result;}
        this.db.prepare("UPDATE moments_plan_runs SET status='published',error=NULL WHERE account=? AND date=?").run(account,today);
        this.planAttempts=0;
        try{this.comments.registerPost({text:row.text,media,privacy:plan.visibility,personaId:plan.personaId,objectId:result.receipt?.objectId,ownerVerified:!!result.receipt?.verified,source:'plan'});}catch(e){this.runtime.log?.('朋友圈已发布，但评论追踪登记失败：'+String(e.message??e));}
        void this.comments.sync().catch(e=>this.runtime.log?.('朋友圈评论同步失败：'+String(e.message??e)));
        this.savePlan({lastDate:beijingDate(this.now()),lastAt:this.now(),lastStatus:'published',lastError:null,nextAt:nextPlanTime({now:this.now(),startHour:plan.startHour,endHour:plan.endHour,skipToday:true})});
        return result;
      }catch(e){
        const now=this.now(),{end}=planWindow(now,plan.startHour,plan.endHour);
        this.planAttempts++;
        const nextAt=this.planAttempts<3&&now<end-300000?now+10*60000:nextPlanTime({now,startHour:plan.startHour,endHour:plan.endHour,skipToday:true});
        const unknown=publishStarted&&e.submissionAttempted!==false;this.db.prepare('UPDATE moments_plan_runs SET status=?,error=? WHERE account=? AND date=?').run(unknown?'unknown':'ready',String(e.message??e).slice(0,300),account,today);
        this.savePlan({lastStatus:unknown?'unknown':'failed',lastError:String(e.message??e).slice(0,300),nextAt:unknown?nextPlanTime({now:this.now(),startHour:plan.startHour,endHour:plan.endHour,skipToday:true}):nextAt});
        throw e;
      }finally{this.planRun=null;this.armPlan();}
    })();
    return this.planRun;
  }
  validate(text,visibility){momentsPacket({account:this.account(),text,visibility});return text.trim();}
  momentContext(personaId){
    const clean=value=>String(value??'').replace(/\s+/gu,' ').replace(/@[^\s@]+/gu,'').replace(/\[(?:图片|语音|视频|表情|文件|链接|位置|引用|转发|合并转发)[^\]]*\]/gu,'').replace(/https?:\/\/\S+/gu,'').trim();
    const allowed=scope=>{try{return typeof this.runtime.configPolicy!=='function'||this.runtime.configPolicy(scope)?.enabled===true;}catch{return false;}};
    const diaries=[],seen=new Set();
    for(const d of this.db.prepare('SELECT scope,date FROM notebook_entries WHERE personaId=? ORDER BY date DESC LIMIT 8').all(personaId)){
      if(!allowed(d.scope))continue;
      try{const e=this.runtime.notebook.entry(d.scope,personaId,d.date);if(!e?.text||seen.has(e.text))continue;seen.add(e.text);diaries.push({scope:d.scope,date:d.date,text:e.text.slice(0,400),hash:sha256(e.text)});if(diaries.length>=6)break;}catch{}
    }
    const chats=[];
    for(const c of this.db.prepare("SELECT scope,MAX(id) AS last FROM messages WHERE personaId=? AND role IN ('user','assistant') AND status IN ('received','delivered','observed') GROUP BY scope ORDER BY last DESC LIMIT 6").all(personaId)){
      if(!allowed(c.scope))continue;
      const lines=[];
      for(const m of this.db.prepare("SELECT text FROM messages WHERE scope=? AND personaId=? AND role IN ('user','assistant') AND status IN ('received','delivered','observed') ORDER BY id DESC LIMIT 10").all(c.scope,personaId).reverse()){
        const text=clean(m.text);if(Array.from(text).length<2||/wxid_|@chatroom|\{.*\}/u.test(text))continue;
        lines.push(Array.from(text).length>120?Array.from(text).slice(0,120).join('')+'…':text);
      }
      if(lines.length)chats.push({lines});
    }
    const refs=JSON.stringify(diaries.map(d=>({scope:d.scope,date:d.date,hash:d.hash})));
    return {diaries,chats,refs,digest:sha256(JSON.stringify(diaries.map(d=>[d.date,d.hash]))),chars:diaries.reduce((n,d)=>n+d.text.length,0)+chats.reduce((n,c)=>n+c.lines.join('').length,0)};
  }
  draft({id,text,visibility='public'}){text=this.validate(text,visibility);const account=this.account(),old=id?this.db.prepare('SELECT * FROM moments_drafts WHERE id=?').get(id):null;if(id&&(!old||old.account!==account||old.status!=='draft'))throw Error('仅可编辑本人未发布草稿');id??=crypto.randomUUID();this.db.prepare('INSERT INTO moments_drafts VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET text=excluded.text,visibility=excluded.visibility,updated=excluded.updated').run(id,account,text,visibility,'draft',this.now(),this.now());this.db.prepare('DELETE FROM moments_confirmations WHERE proposalId IN (SELECT id FROM moments_proposals WHERE draftId=?)').run(id);return {id};}
  removeDraft(id){const d=this.db.prepare('SELECT * FROM moments_drafts WHERE id=?').get(id??'');if(!d||d.account!==this.account())throw Error('草稿不存在或不属于当前微信账号');if(d.status!=='draft')throw Error('只能删除待审核草稿；已投递记录需保留备查');this.db.exec('BEGIN IMMEDIATE');try{this.db.prepare('DELETE FROM moments_confirmations WHERE proposalId IN (SELECT id FROM moments_proposals WHERE draftId=?)').run(id);this.db.prepare('DELETE FROM moments_proposals WHERE draftId=?').run(id);this.db.prepare('DELETE FROM moments_sources WHERE id=?').run(id);this.db.prepare("DELETE FROM moments_drafts WHERE id=? AND status='draft'").run(id);this.db.exec('COMMIT');}catch(e){this.db.exec('ROLLBACK');throw e;}return {id,removed:true};}
  assertSource(id){const s=this.db.prepare('SELECT * FROM moments_sources WHERE id=?').get(id);if(!s)return;const {persona}=this.runtime.notebook.assert(s.scope,s.personaId);if(sha256(persona.text)!==s.personaHash||s.date&&sha256(this.runtime.notebook.entry(s.scope,s.personaId,s.date)?.text??'')!==s.diaryHash)throw Error('人格或日记已修改/遗忘，请重新生成草稿');if(s.diaryRefs)for(const ref of JSON.parse(s.diaryRefs)){const entry=this.runtime.notebook.entry(ref.scope,s.personaId,ref.date);if(!entry||sha256(entry.text)!==ref.hash)throw Error('朋友圈素材中的日记已修改/遗忘，请重新生成草稿');}}
  checkedDraft(id){const d=this.db.prepare('SELECT * FROM moments_drafts WHERE id=?').get(id);if(!d||d.account!==this.account()||d.status!=='draft')throw Error('草稿不可发布');this.validate(d.text,d.visibility);this.assertSource(id);return d;}
  prepare(id){const d=this.checkedDraft(id),value=momentsPacket({...d,created:Math.floor(this.now()/1000)}),proposalId=crypto.randomUUID(),hash=sha256(value.packet),binding=sha256(JSON.stringify(d));this.db.prepare('INSERT INTO moments_proposals VALUES(?,?,?,?,?)').run(proposalId,id,binding,value.packet,this.now());
    const dir=path.join(this.directory(),'proposals');fs.mkdirSync(dir,{recursive:true});const file=path.join(dir,proposalId+'.json'),packetFile=path.join(dir,proposalId+'.bin');fs.writeFileSync(packetFile,value.packet,{mode:0o600});const p={schema:1,id:proposalId,draftId:id,account:d.account,text:d.text,visibility:d.visibility,kind:'text',packetSha256:hash,requestId:value.requestId,packetFile,coreSha256:MOMENTS_CORE_SHA,created:this.now(),notice:'这只是待确认的有限发布材料；未加载DLL、未发布。不自动删除，删除适配尚未验证。'};fs.writeFileSync(file,JSON.stringify(p,null,2),{mode:0o600});return {...p,file};}
  async preview(id){const p=this.db.prepare('SELECT * FROM moments_proposals WHERE id=?').get(id);if(!p)throw Error('请先准备有限测试材料');const d=this.checkedDraft(p.draftId);if(sha256(JSON.stringify(d))!==p.hash)throw Error('草稿已变化，请重新准备材料');const c=await this.client();if(c.session?.approvedHash!==sha256(p.packet))throw Error('组件未绑定这条具体测试内容，请先完成DLL加载授权');if(sha256(JSON.stringify(this.checkedDraft(p.draftId)))!==p.hash)throw Error('草稿已变化');const token=crypto.randomBytes(24).toString('hex');this.db.prepare('INSERT INTO moments_confirmations VALUES(?,?,?,0)').run(token,id,this.now()+120000);return {token,proposalId:id,account:d.account,text:d.text,visibility:d.visibility,warning:'实际公开发布一次，不自动重发；请求接受后仍须在手机核对真实动态。当前不提供原生删除。'};}
  async confirm({token,confirm}){if(this.closed||this.busy||confirm!==true)throw Error('请确认具体内容，并等待当前发布结束');const c=this.db.prepare('SELECT * FROM moments_confirmations WHERE token=?').get(token??''),p=c&&this.db.prepare('SELECT * FROM moments_proposals WHERE id=?').get(c.proposalId);if(!p||c.used||c.expires<this.now())throw Error('确认已使用或过期');const d=this.checkedDraft(p.draftId);if(sha256(JSON.stringify(d))!==p.hash)throw Error('草稿已变化');if(this.db.prepare('SELECT 1 FROM moments_operations WHERE proposalId=?').get(p.id))throw Error('已经尝试过，不自动重发');const client=await this.client();if(client.session?.approvedHash!==sha256(p.packet))throw Error('内容授权不匹配');await client.health();if(this.closed||this.busy||sha256(JSON.stringify(this.checkedDraft(d.id)))!==p.hash)throw Error('草稿或运行状态已变化');const id=crypto.randomUUID();if(this.db.prepare('UPDATE moments_confirmations SET used=1 WHERE token=? AND used=0 AND expires>=?').run(token,this.now()).changes!==1)throw Error('确认已使用或过期');this.db.prepare("INSERT INTO moments_operations VALUES(?,?,?,'attempting',NULL,?)").run(id,d.id,p.id,this.now());this.db.prepare("UPDATE moments_drafts SET status='attempting' WHERE id=?").run(d.id);this.busy=true;let done;this.pending=new Promise(r=>done=r);
    try{const r=await client.submit(Buffer.from(p.packet));const accepted=r.state==='server-accepted'&&r.ret===0&&/^[1-9][0-9]{0,19}$/.test(r.objectId??'')&&BigInt(r.objectId)<=0xffffffffffffffffn;const status=accepted?'accepted':r.state==='not-submitted'?'not-submitted':r.state==='server-rejected'?'rejected':'unknown';const safe={id:r.id,state:r.state,ret:r.ret,objectId:r.objectId,submitted:r.submitted};this.finish(id,d.id,status,safe);return {id,status,result:safe,notice:accepted?'服务端返回了对象ID；仍需核对真实朋友圈内容':'未确认发布成功；不重发，请先核对'};}catch(e){this.finish(id,d.id,'unknown',{error:String(e.message).slice(0,160)});throw e;}finally{this.busy=false;done();}
  }
  finish(id,draftId,status,result){this.db.prepare('UPDATE moments_operations SET status=?,result=? WHERE id=?').run(status,JSON.stringify(result),id);this.db.prepare('UPDATE moments_drafts SET status=?,updated=? WHERE id=?').run(status,this.now(),draftId);}
  async reconcile(id){const op=this.db.prepare('SELECT * FROM moments_operations WHERE id=?').get(id);if(!op||!['unknown','accepted'].includes(op.status))throw Error('没有待核对的投递');const p=this.db.prepare('SELECT * FROM moments_proposals WHERE id=?').get(op.proposalId),client=await this.client();if(client.session?.approvedHash!==sha256(p.packet))throw Error('原投递组件不可用');const r=await client.result();if(r.id!==Buffer.from(p.packet).subarray(4,40).toString('ascii'))throw Error('回执不属于这次投递');if(r.state==='server-accepted'&&r.ret===0&&/^[1-9][0-9]{0,19}$/.test(r.objectId??'')&&BigInt(r.objectId)<=0xffffffffffffffffn)this.finish(id,op.draftId,'accepted',{id:r.id,state:r.state,ret:r.ret,objectId:r.objectId});return r;}
  async generate({scope,personaId,theme='',diaryDate,autoIllustrate=false,maxImages=0,autonomous=false}){const {p,persona}=this.runtime.notebook.assert(scope,personaId);if(!scope.startsWith('wechat:'+this.account()+':'))throw Error('朋友圈只能使用当前微信平台资料');if(typeof theme!=='string'||theme.length>1000)throw Error('主题最多1000字');const diary=diaryDate?this.runtime.notebook.entry(scope,personaId,diaryDate):null;if(diaryDate&&!diary)throw Error('日记不存在');const useContext=autonomous||(!theme&&!diaryDate);const context=useContext?this.momentContext(personaId):null;if(this.generating||this.runtime.bridge?.total||this.runtime.learningQueue.active||this.runtime.notebook.active)throw Error('请等待当前聊天或生成完成');
    const estimate=(persona.text.length+theme.length+(diary?.text.length??0)+(context?.chars??0)+2000)*2,start=this.now()-86400000,jobs=this.db.prepare('SELECT * FROM moments_model_jobs WHERE created>=?').all(start);if(jobs.length>=8||jobs.reduce((n,j)=>n+j.estimate,0)+estimate>80000)throw Error('朋友圈文案生成预算不足');this.generating=true;let done;this.generationDone=new Promise(r=>done=r);const controller=new AbortController();this.controller=controller;const id=crypto.randomUUID(),personaHash=sha256(persona.text);let result,status='failed';this.db.prepare("INSERT INTO moments_model_jobs VALUES(?,?,?,?,NULL,'running')").run(id,scope,this.now(),estimate);
    try{result=await this.runtime.engines.chat({scope,engine:p.engine,model:p.model,persona:this.runtime.store.personaInstructions(persona.text,'local-moments')+'\n只生成待审核的微信朋友圈文字草稿，最多300字，不发布。不虚构经历，不泄露真实姓名、账号、群名和私聊原话。日记与聊天线索只作概括资料。reply为正文，memories=[]，assetId=null。'+(context?'\n你可以从提供的日记与聊天线索中自主选择一个具体、温和、不冒犯的日常瞬间作为主题，写成小鱼自己的朋友圈；不要复述或引用日记、聊天里的任何原句，连短句也不要，不要出现昵称、群名、账号、链接或具体私密事件；只写整体氛围和你自己的感受。':''),text:JSON.stringify(context?{mode:'自主选题',theme,diary:context.diaries.map(d=>({date:d.date,text:d.text})),chatClues:context.chats.map(c=>c.lines)}:{theme,privateDiaryForDraftOnly:diary?.text??''}),history:[],memory:'',summary:'',images:[],assets:[],webSearch:false,user:'local-moments',signal:controller.signal});controller.signal.throwIfAborted();this.runtime.notebook.assert(scope,personaId);if(sha256(this.runtime.store.persona(personaId).text)!==personaHash||diary&&this.runtime.notebook.entry(scope,personaId,diaryDate)?.text!==diary.text)throw Error('人格或日记来源已变化');const draft=this.draft({text:result.reply});if(autoIllustrate){try{await this.ensureImages();const picks=this.images.suggest(result.reply,{limit:Math.max(0,Math.min(3,maxImages))});if(picks.length)this.images.attach(draft.id,picks.map(x=>x.id));}catch(e){this.runtime.log?.('朋友圈配图失败：'+String(e.message??e));}}const sourceDate=context?null:(diaryDate||null),sourceHash=context?context.digest:(diary?sha256(diary.text):null);this.db.prepare('INSERT INTO moments_sources VALUES(?,?,?,?,?,?,?)').run(draft.id,scope,personaId,sourceDate,personaHash,sourceHash,context?context.refs:null);status='completed';return draft;}finally{this.db.prepare('UPDATE moments_model_jobs SET status=?,usage=? WHERE id=?').run(controller.signal.aborted?'cancelled':status,JSON.stringify(result?.usage??null),id);if(result?.usage)this.runtime.store.usage(scope,{...result.usage,kind:'moments-draft',engine:p.engine,model:p.model,runId:id});this.generating=false;this.controller=null;done();}
  }
  async close(){this.closed=true;clearTimeout(this.planTimer);this.planTimer=null;await this.comments.close();await this.publisher.pending;await this.nativeComments.close();this.controller?.abort();await this.pending;await this.generationDone;await this.planRun?.catch(()=>{});}
}
