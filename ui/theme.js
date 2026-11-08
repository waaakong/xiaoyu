(()=>{
  let theme='dark';try{const saved=localStorage.getItem('xy-theme');if(['dark','light'].includes(saved))theme=saved;}catch{}
  function apply(value){theme=value;document.documentElement.dataset.theme=value;document.documentElement.style.colorScheme=value;window.desktop?.setTheme?.(value);const button=document.getElementById('toggleTheme');if(button){button.setAttribute('aria-label',value==='dark'?'切换浅色主题':'切换深色主题');button.title=button.getAttribute('aria-label');const label=button.querySelector('span');if(label)label.textContent=value==='dark'?'浅色':'深色';}}
  apply(theme);window.xyTheme={set:apply,toggle(){const value=theme==='dark'?'light':'dark';try{localStorage.setItem('xy-theme',value);}catch{}apply(value);},current:()=>theme};
  document.addEventListener('DOMContentLoaded',()=>apply(theme));
})();

// Startup guard intentionally lives in the first classic script: it still runs
// when an ESM dependency fails before app.js can register an error handler.
(()=>{
  let completed=false,failed=false,stage='加载界面模块';const root=document.documentElement;
  const busy=()=>!completed&&(root.classList.contains('app-booting')||root.classList.contains('app-loading'));
  const render=()=>{const splash=document.querySelector('.boot-splash'),message=document.getElementById('bootMessage'),detail=document.getElementById('bootDetail'),retry=document.getElementById('bootRetry');if(!splash)return;if(retry)retry.onclick=()=>location.reload();if(!failed)return;root.classList.add('app-boot-failed');if(message)message.textContent='工作台未能完成加载';if(detail){detail.hidden=false;detail.textContent=stage;}if(retry)retry.hidden=false;};
  const fail=message=>{if(!busy())return;failed=true;stage=String(message).slice(0,200);render();};
  const timer=setTimeout(()=>{if(busy())fail('初始化超时：'+stage+'。本机服务可能较慢，可稍等或重新加载。');},20000);
  window.xyBootGuard={stage:value=>{if(!failed)stage=String(value).slice(0,80);},fail,complete(){completed=true;failed=false;clearTimeout(timer);root.classList.remove('app-boot-failed');}};
  window.addEventListener('error',event=>{if(!busy())return;let file='';try{file=new URL(event.target?.src||event.target?.href||event.filename||'',location.href).pathname;}catch{}fail('界面脚本或资源加载失败'+(file?'：'+file:'')+'。请重新加载；若持续出现，请重启小鱼以加载同一版本的界面和服务。');},true);
  window.addEventListener('unhandledrejection',()=>fail('界面初始化异常。请重新加载；若持续出现，请重启小鱼。'));
  document.addEventListener('DOMContentLoaded',render);
})();
