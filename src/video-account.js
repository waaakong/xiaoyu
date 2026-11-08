// Only rendered, first-party self entry points. Never treat a creator's profile as a login identity.
export function visibleAccountElement(e){if(!e)return false;const r=e.getBoundingClientRect(),s=e.ownerDocument.defaultView.getComputedStyle(e);return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden';}
export function ownVideoAccount(doc,platform){
 const visible=e=>{if(!e)return false;const r=e.getBoundingClientRect(),s=doc.defaultView.getComputedStyle(e);return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden';};
 if([...doc.querySelectorAll('iframe[src*="captcha"],.captcha_verify_container,[data-e2e="captcha-dialog"]')].some(visible))return {status:'verification'};
 if(platform==='bilibili'){
  const ids=[...doc.querySelectorAll('.header-avatar-wrap a[href],a.header-entry-avatar[href]')].filter(visible).flatMap(e=>{try{const u=new URL(e.getAttribute('href'),doc.location.href);if(u.protocol!=='https:'||u.hostname!=='space.bilibili.com'||!/^\/[1-9]\d{0,19}\/?$/.test(u.pathname))return [];return [u.pathname.replaceAll('/','')];}catch{return [];}});
  const unique=[...new Set(ids)];if(unique.length===1)return {status:'verified',fields:{publicId:unique[0],nickname:'',profileUrl:'https://space.bilibili.com/'+unique[0]},source:'B站本人头像入口'};
  return {status:[...doc.querySelectorAll('.header-login-entry,.header-login-btn')].some(visible)?'signed-out':'unknown'};
 }
 if(platform==='douyin'){
  // This function runs only in a newly created page navigated to /user/self.
  // Require that exact endpoint; a creator /user/<id> is insufficient evidence.
  if(doc.location.hostname!=='www.douyin.com'||doc.location.pathname!=='/user/self')return {status:'unknown'};
  const info=[...doc.querySelectorAll('[data-e2e="user-info"]')].find(visible),text=info?.innerText??'',number=text.match(/抖音号[：:]\s*([A-Za-z0-9_.-]{1,64})(?:\s|$)/u)?.[1];
  if(number){const heading=[...info.querySelectorAll('h1,h2,[data-e2e="user-title"]')].find(visible);return {status:'verified',fields:{publicId:number,nickname:(heading?.innerText??'').trim().slice(0,60),profileUrl:'https://www.douyin.com/user/self'},source:'抖音本人入口 /user/self 的账号资料'};}
  return {status:[...doc.querySelectorAll('[data-e2e="login-dialog"],.login-panel')].some(visible)?'signed-out':'unknown'};
 }
 return {status:'unknown'};
}
