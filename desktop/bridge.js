(() => {
  const pending=new Map();let sequence=0;
  window.chrome.webview.addEventListener('message',event=>{
    const message=event.data;if(message?.type==='window-state'){window.dispatchEvent(new CustomEvent('desktop-window-state',{detail:message}));return;}if(message?.type!=='panel-open-result')return;
    const request=pending.get(message.id);if(!request)return;
    pending.delete(message.id);clearTimeout(request.timer);
    if(message.ok)request.resolve();else request.reject(new Error(message.error||'无法打开插件管理窗口，请复制管理地址。'));
  });
  window.desktop={native:true,
    windowAction(action){if(['minimize','maximize','close','state'].includes(action))window.chrome.webview.postMessage(JSON.stringify({type:'window-action',action}));},
    openDependencyPage(key){if(['webview2','dotnet','python','astrbot','snowluma','napcat','qq','codex','voice','speech'].includes(key))window.chrome.webview.postMessage(JSON.stringify({type:'open-dependency-page',key}));},
    setTheme(value){if(value==='dark'||value==='light')window.chrome.webview.postMessage(JSON.stringify({type:'theme',value}));},
    setDirty(value){window.chrome.webview.postMessage(JSON.stringify({type:'dirty',value:value===true}));},
    openServiceDashboard(kind){if(!["snowluma","napcat"].includes(kind))return Promise.reject(new Error("未知服务"));return new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(new Error("打开协议控制台超时"));},25000);pending.set(id,{resolve,reject,timer});window.chrome.webview.postMessage(JSON.stringify({type:"open-service-panel",kind,id}));});},
    openPluginDashboard(){return new Promise((resolve,reject)=>{
      const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(new Error('打开插件管理超时，请复制管理地址。'));},25000);
      pending.set(id,{resolve,reject,timer});
      window.chrome.webview.postMessage(JSON.stringify({type:'open-plugin-panel',id}));
    });}
  };
})();
