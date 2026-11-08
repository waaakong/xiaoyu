const {createInterface}=require('node:readline');
function send(v){process.stdout.write(JSON.stringify(v)+'\n');}
createInterface({input:process.stdin}).on('line',line=>{
  const m=JSON.parse(line);if(!m.method)return;
  if(m.method==='initialize')send({id:m.id,result:{}});
  else if(m.method==='thread/start'){
    if(m.params.sandbox!=='read-only'||m.params.approvalPolicy!=='on-request'||m.params.config['features.shell_tool']!==false)throw Error('unsafe policy');
    send({id:m.id,result:{thread:{id:'fake'}}});
  }else if(m.method==='turn/start'){
    if(!m.params.outputSchema||m.params.environments.length)throw Error('invalid chat request');
    send({id:m.id,result:{turn:{id:'turn1'}}});
    send({method:'turn/started',params:{threadId:'fake',turn:{id:'turn1'}}});
    send({id:987,method:'item/commandExecution/requestApproval',params:{threadId:'fake'}});
    send({method:'item/completed',params:{threadId:'fake',item:{type:'agentMessage',phase:'final_answer',text:JSON.stringify({reply:'模拟回复',memories:[]})}}});
    send({method:'turn/completed',params:{threadId:'fake',turn:{id:'turn1',status:'completed'}}});
  }else if(m.id!=null)send({id:m.id,result:{}});
});
