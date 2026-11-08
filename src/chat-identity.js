const id=/^[-\w@.]{1,160}$/;
export function parseScope(scope){
  const m=/^(qq|wechat):([^:]+):(private|group):([^:]+)(?::member:([^:]+))?$/.exec(String(scope));
  if(!m||![m[2],m[4],...(m[5]?[m[5]]:[])].every(s=>m[1]==='qq'?/^\d+$/.test(s):id.test(s)))throw Error('聊天编号无效');
  return {platform:m[1],account:m[2],kind:m[3],peer:m[4],member:m[5],scope:`${m[1]}:${m[2]}:${m[3]}:${m[4]}`};
}
export function validId(value,platform='qq'){return typeof value==='string'&&(platform==='qq'?/^\d+$/.test(value):id.test(value));}
export function identity(scope,member){const who=parseScope(scope);if(who.member)throw Error('请使用聊天作用域');const owner=who.kind==='private'?who.peer:String(member??'');if(!validId(owner,who.platform))throw Error('请指定真实成员ID');return {...who,owner};}
export function sameDomain(a,b){return a.platform===b.platform&&a.account===b.account;}
