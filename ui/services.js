export function createServiceUI({api,notice,run}){
  const $=id=>document.getElementById(id);let filled=false,edited=false,lastConfig='';
  function fill(c){$('serviceEnabled').checked=c.enabled;$('serviceProtocol').value=c.protocol;$('serviceSnowPath').value=c.snowlumaPath;$('serviceNapPath').value=c.napcatPath;$('serviceNapPort').value=c.napcatPort;$('serviceAstrbot').checked=c.astrbot;filled=true;lastConfig=JSON.stringify(c);}
  if(!$('serviceSave'))return {paint(){}};
  for(const id of ['serviceEnabled','serviceProtocol','serviceSnowPath','serviceNapPath','serviceNapPort','serviceAstrbot'])$(id)?.addEventListener?.('input',()=>edited=true);
  $('serviceDetect').onclick=()=>run($('serviceDetect'),async()=>{const result=await api('services/detect',{});fill(result.suggested);notice('已填入发现的原版目录，请核对并保存；没有修改官方服务配置。');});
  $('serviceSave').onclick=()=>run($('serviceSave'),async()=>{await api('services/save',{enabled:$('serviceEnabled').checked,protocol:$('serviceProtocol').value,snowlumaPath:$('serviceSnowPath').value.trim(),napcatPath:$('serviceNapPath').value.trim(),napcatPort:Number($('serviceNapPort').value),astrbot:$('serviceAstrbot').checked});edited=false;notice('服务设置已保存。开启统一启动后，下次打开小鱼会按此配置启动。');});
  $('serviceStart').onclick=()=>run($('serviceStart'),async()=>{await api('services/start',{});notice('已执行统一启动，请查看各项就绪状态；QQ首次登录需在官方页面完成。');});
  $('serviceStop').onclick=()=>run($('serviceStop'),async()=>{await api('services/stop',{});notice('已停止小鱼接收与托管服务；保留QQ和外部服务，不自动卸载QQ Hook。');});
  $('servicePanel').onclick=event=>{if(!window.desktop?.native)return;event.preventDefault();run($('servicePanel'),async()=>{const result=await api('services/panel',{});if(!window.desktop.openServiceDashboard)throw Error('请重新打开小鱼，加载新版桌面窗口');await window.desktop.openServiceDashboard(result.kind);notice('已打开官方协议管理窗口。');});};
  return {paint(s){if(!s)return;if(!filled||!edited&&JSON.stringify(s.config)!==lastConfig)fill(s.config);$('servicePanel').href=s.panelURL??'#';const labels={ready:'控制台就绪',starting:'启动中',stopped:'已停止','external-ready':'复用外部控制台','qq-connected':'QQ已连接'};$('serviceStatus').textContent=(labels[s.health]??'尚未启动检查')+(s.owned?' · 小鱼托管':' · 外部服务不会被停止')+(s.lastError?' · '+s.lastError:'');$('serviceHookHint').textContent=s.config.protocol==='snowluma'&&s.autoHook===false?'SnowLuma尚未开启官方自动加载。请在协议管理中完成首次设置，之后才能随QQ启动自动接入。':'';}};
}
