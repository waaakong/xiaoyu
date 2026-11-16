// Global connections must not be replaced by the selected platform's runtime state.
export function connectionChips(connections={},platform='qq'){
 const q=connections.qq??{},w=connections.wechat??{},e=connections.engines??{},current=platform==='wechat'?w:q;
 const plugin=current.integrations?.plugins?.gateway??{};
 const channel=(id,label,data,page)=>({id,label:label+' '+(data.connected?'在线':data.error?'异常':data.running?'待连接':'未启动'),online:!!data.connected,page,platform:id==='headerQq'?'qq':'wechat',detail:[data.accountId||'',data.mode||data.integrations?.protocol?.name||'',data.error||'',connections.at?'刷新于 '+new Date(connections.at).toLocaleTimeString('zh-CN'):'' ].filter(Boolean).join(' · ')});
 return [channel('headerQq','QQ',q,'integrations'),channel('headerWechat','微信',w,'wechatConnection'),
 {id:'headerCodex',label:'Codex '+(connections.codex?.connected?'已连接':'未连接'),online:!!connections.codex?.connected,page:'engines',detail:'本机 Codex 连接'},
 {id:'headerDsh',label:'DSH '+(e.dsh?.connected?'已连接':'未连接'),online:!!e.dsh?.connected,page:'engines',detail:e.dsh?.error||'DSH 连接、模型与额度'},
 {id:'headerPlugins',label:(platform==='wechat'?'微信':'QQ')+'插件 '+(plugin.connected?'已连接':'未连接'),online:!!plugin.connected,page:'plugins',detail:plugin.error||'当前'+(platform==='wechat'?'微信':'QQ')+'工作台的插件通道'}];
}
