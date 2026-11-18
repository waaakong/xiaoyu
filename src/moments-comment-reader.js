// Bounded read-only discovery/detail batch. Reply policy is deliberately absent:
// observing one's own comments does not grant permission to reply to them.
const validId=v=>typeof v==='string'&&/^[1-9][0-9]{0,19}$/.test(v)&&BigInt(v)<=0xffffffffffffffffn;
const oldest=posts=>posts.reduce((id,p)=>BigInt(p.objectId)<BigInt(id)?p.objectId:id,posts[0].objectId);
const complete=p=>p?.commentsComplete===true;
export async function readOwnCommentBatch({client,account,knownPosts=[],states=new Map(),historyCursor='0',saveCursor=()=>{},record=()=>{},assertAccount=()=>{},now=Date.now,automatic=false,detailLimit=8}){
 if(!Number.isInteger(detailLimit)||detailLimit<1||detailLimit>8)throw Error('评论详情补查预算无效');
 const posts=new Map(),warnings=[];let nextCursor=historyCursor,detailReads=0;
 const merge=p=>{
  if(!validId(p?.objectId)||p.ownerId!==account||p.identityVerified!==true)throw Error('评论动态身份未核验');
  const prior=posts.get(p.objectId),rows=new Map();
  for(const c of [...(prior?.comments??[]),...(p.comments??[])])rows.set(c.remoteId??JSON.stringify([c.username,c.content,c.createdAt]),c);
  posts.set(p.objectId,{...prior,...p,comments:[...rows.values()]});
 };
 const first=await client.page('0');assertAccount();for(const p of first.posts)merge(p);
 if(first.posts.length){
  const cursor=historyCursor==='0'?oldest(first.posts):historyCursor;
  try{const older=await client.page(cursor);assertAccount();for(const p of older.posts)merge(p);nextCursor=older.posts.length?oldest(older.posts):'0';if(nextCursor===cursor)nextCursor='0';saveCursor(nextCursor);}
  catch(e){assertAccount();warnings.push({stage:'history',reason:String(e.message).slice(0,180)});}
 }else{nextCursor='0';saveCursor('0');}
 const known=new Map(knownPosts.filter(p=>validId(p.objectId)).map(p=>[p.objectId,p]));for(const p of posts.values())known.set(p.objectId,p);
 const candidates=[...known.values()].filter(p=>!complete(posts.get(p.objectId))).filter(p=>{
  const state=states.get(p.objectId),page=posts.get(p.objectId);
  const changed=page?.commentCount!=null&&state?.remoteCount!=null&&page.commentCount!==state.remoteCount;
  return !automatic||!state||now()-state.attemptedAt>=120000||changed;
 }).sort((a,b)=>(states.get(a.objectId)?.attemptedAt??0)-(states.get(b.objectId)?.attemptedAt??0)||(b.publishedAt??0)-(a.publishedAt??0)||a.objectId.localeCompare(b.objectId));
 if(!client.unknown)for(const p of candidates.slice(0,detailLimit)){
  assertAccount();const attemptedAt=now();detailReads++;
  try{const detail=await client.post(p.objectId);assertAccount();merge(detail);const state={attemptedAt,complete:complete(detail),remoteCount:detail.commentCount??null,error:null};states.set(p.objectId,state);record(p.objectId,state);}
  catch(e){assertAccount();const state={attemptedAt,complete:false,remoteCount:null,error:String(e.message).slice(0,180)};states.set(p.objectId,state);record(p.objectId,state);warnings.push({stage:'detail',objectId:p.objectId,reason:state.error});if(client.unknown)break;}
 }
 const unresolved=[...known.keys()].filter(id=>!posts.get(id)?.deleted&&!complete(posts.get(id))&&!states.get(id)?.complete).length;
 const deferred=Math.max(0,candidates.length-detailReads),incomplete=[...posts.values()].filter(p=>!p.deleted&&!complete(p)).length;
 const coverage={knownPosts:known.size,detailReads,deferredDetails:deferred,unresolvedPosts:unresolved,incompletePosts:incomplete,historyPending:nextCursor!=='0',warnings,partial:!!(deferred||unresolved||incomplete||nextCursor!=='0'||warnings.length)};
 return {source:'native-service',fresh:true,posts:[...posts.values()],coverage};
}
