import {money2} from './money-format.js';
export function balanceIntent(text){const s=String(text??'').trim();return /^\/余额\s*(?:dsh|deepseek)?$/iu.test(s)||/(?:dsh|deepseek|深度求索)/iu.test(s)&&/余额|钱包/u.test(s)&&(/查|看|多少|剩|显示|[?？]/u.test(s)||/^(?:dsh|deepseek|深度求索)\s*(?:的)?余额[。！!]?$/iu.test(s));}
export class BalanceCommands {
 constructor(runtime){this.runtime=runtime;}
 owner(user){return !!user&&String(user)===this.runtime.store.meta('fixed-memory-owner');}
 async handle(r){
  if(!balanceIntent(r.text)||this.runtime.store.isPaused(r.memberScope??r.scope))return false;
  const authorize=()=>this.owner(r.user),reply=text=>this.runtime.bridge.sendPersonaNotice({scope:r.scope,creator:r.user,personaId:r.policy.personaId,request:r.text},text,{control:true,source:'余额查询',authorize});
  if(!authorize()){await this.runtime.bridge.onebot.reply(r.event,'余额详情只向主人开放。',{beforeSend:()=>{if(!this.runtime.configPolicy(r.scope).enabled)throw Error('聊天授权已变化');}});return true;}
  let answer;
  try{
   if(this.runtime.engines.dsh.closed)await this.runtime.engines.connectDsh();else await this.runtime.engines.refreshQuotas('dsh',true);
   const snapshot=this.runtime.engines.quota.view('dsh');
   if(snapshot.status!=='ready'||!snapshot.wallets?.length)answer='这会儿没查到DSH的最新余额，旧数字我就不拿来报了。你看下DSH账号是不是还在线。';
   else{const amounts=snapshot.wallets.map(w=>`${w.kind==='bonus'?'赠送':'充值'}余额 ${money2(w.balance)} ${w.currency==='CNY'?'元':w.currency==='USD'?'美元':w.currency}`);answer='刚查了一下，DSH'+amounts.join('，');}
  }catch{answer='这次没查到最新余额，等DSH连接恢复再查。';}
  if(authorize())await reply(answer);return true;
 }
}
