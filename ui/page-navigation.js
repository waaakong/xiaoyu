// One owner for navigation, asynchronous preparation, scroll and animation.
// A late request can populate its own cache, but cannot select an older page.
export function createPageNavigation({exists,select,readScroll,writeScroll,animate=()=>{},loading=()=>{},onError=()=>{},initial='overview'}){
  let current=initial,sequence=0,stopAnimation;const positions=new Map();
  function stop(){stopAnimation?.();stopAnimation=undefined;}
  async function go(id,prepare){
    const request=++sequence;stop();loading(!!prepare,id);
    const isCurrent=()=>request===sequence;
    try{
      if(prepare){const ready=await prepare({isCurrent});if(!isCurrent()||ready===false)return false;}
      if(!isCurrent())return false;
      if(!exists(id))throw Error('页面尚未准备好，请重试');
      loading(false,id);
      if(id===current){select(id);return true;}
      positions.set(current,readScroll());select(id);current=id;
      writeScroll(positions.get(id)??0);stopAnimation=animate(id);
      return true;
    }catch(error){if(isCurrent()){loading(false,id);onError(error);}return false;}
    finally{if(isCurrent())loading(false,id);}
  }
  return {go,current:()=>current,destroy(){sequence++;stop();loading(false,current);}};
}

export function installPageNavigation({notice}){
  const scroller=()=>document.getElementById('workspaceScroll');let hintTimer;
  const nav=createPageNavigation({
    exists:id=>!!document.getElementById(id)?.classList.contains('page'),
    readScroll:()=>scroller()?.scrollTop??0,
    writeScroll:value=>{if(scroller())scroller().scrollTop=value;},
    select:id=>{
      for(const p of document.querySelectorAll('.page'))p.hidden=p.id!==id;
      for(const b of document.querySelectorAll('nav [data-page]')){const selected=b.dataset.page===id;b.classList.toggle('selected',selected);b.setAttribute('aria-current',selected?'page':'false');if(selected)b.closest('details')?.setAttribute('open','');}
      const button=document.querySelector(`nav [data-page="${CSS.escape(id)}"]`);
      document.getElementById('breadcrumb').textContent=button?.dataset.title||button?.querySelector('.nav-label')?.textContent||id;
    },
    loading:busy=>{
      clearTimeout(hintTimer);const root=document.documentElement,breadcrumb=document.getElementById('breadcrumb');
      if(busy){root.classList.add('page-preparing');hintTimer=setTimeout(()=>{if(breadcrumb)breadcrumb.dataset.loading='true';},160);}
      else{root.classList.remove('page-preparing');if(breadcrumb)delete breadcrumb.dataset.loading;}
    },
    animate:id=>{
      const page=document.getElementById(id),gsap=window.gsap;
      const clean=()=>{page.style.removeProperty('will-change');page.style.removeProperty('transform');page.style.removeProperty('opacity');};
      if(!gsap||document.documentElement.classList.contains('app-loading')||window.xyMotionDisabled?.()||window.xyKeyboardNavigation?.()||matchMedia('(prefers-reduced-motion: reduce)').matches)return clean;
      page.style.willChange='transform,opacity';
      const tween=gsap.fromTo(page,{y:6,opacity:.5},{y:0,opacity:1,duration:.2,ease:'power3.out',overwrite:true,onComplete:clean});
      return ()=>{tween.kill();clean();};
    },
    onError:error=>notice(error.message||'页面加载失败，请重试',true)
  });
  window.addEventListener('pagehide',()=>nav.destroy(),{once:true});return nav;
}

const subviews=new WeakMap();
export function animateSubview(panel){
  if(!panel?.isConnected||panel.closest('.page')?.hidden||document.documentElement.classList.contains('app-loading')||document.documentElement.classList.contains('app-booting'))return;
  const scope=panel.parentElement;subviews.get(scope)?.();
  const clean=()=>{panel.style.removeProperty('will-change');panel.style.removeProperty('transform');panel.style.removeProperty('opacity');};
  if(!window.gsap||window.xyMotionDisabled?.()||matchMedia('(prefers-reduced-motion: reduce)').matches||panel.closest('.page')?.style.willChange)return;
  panel.style.willChange='transform,opacity';
  const tween=window.gsap.fromTo(panel,{y:3,opacity:.5},{y:0,opacity:1,duration:.16,ease:'power2.out',overwrite:true,onComplete:clean});
  subviews.set(scope,()=>{tween.kill();clean();});
}
