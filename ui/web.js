export function createWebUI({$,api,node,run}){
  function paint(web){const target=$('webOperations');target.replaceChildren();for(const o of [...(web?.operations??[])].reverse())target.append(node('p','',new Date(o.at).toLocaleTimeString('zh-CN')+' · '+(o.engine==='dsh'?'DSH原生':'Codex原生')+' · '+o.kind+' · '+o.status+' · '+o.durationMs+'ms'));if(!target.childNodes.length)target.append(node('p','','还没有原生联网执行记录。'));}
  $('webSearchProbe').onclick=()=>run($('webSearchProbe'),async()=>{$('webProbeResult').textContent='正在调用模型与原生联网工具…';try{const r=await api('web/diagnostic',{query:$('webProbeQuery').value.trim()});$('webProbeResult').textContent=r.model+' · '+r.totalMs+'ms · 原生状态：'+r.web.status+'\n\n'+r.reply+'\n\n'+r.web.operations.map(o=>o.kind+' · '+o.status+' · '+o.durationMs+'ms').join('\n');}catch(e){$('webProbeResult').textContent='原生联网未完成：'+e.message;throw e;}});
  return {paint};
}
