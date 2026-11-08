// Native DSH web credentials are selected from the initiating agent's route.
// A bare ctx.web call has no account initiator and incorrectly asks account
// users for an API key. Give only this request an empty, owned agent; never
// inherit a user's DSH conversation, tools, prompt, or credential material.
export async function nativeWebContext(ctx,{id,provider,model,cwd,signal}){
  const agents=ctx.get('agents');
  if(provider!=='deepseek-account')return {run:fn=>fn(),dispose:async()=>{}};
  if(!agents?.create||!agents?.withInitiator)throw Object.assign(Error('DSH account web context unavailable'),{code:'WEB_ACCOUNT_CONTEXT_UNAVAILABLE'});
  signal.throwIfAborted();
  const handle=await agents.create({sessionId:'xiaoyu-web-'+id,meta:{cwd},agentOptions:{provider,model},setup:async()=>{},signal});
  try{
    const agent=agents.get?.('xiaoyu-web-'+id)??handle.agent;if(!agent?.session)throw Error('DSH native web agent unavailable');
    agent.session.append('request/context',{provider,model});
    signal.throwIfAborted();
    return {run:fn=>agents.withInitiator(agent,fn),dispose:()=>handle.dispose()};
  }catch(error){await handle.dispose();throw error;}
}
