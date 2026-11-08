export function adaptWeChatChatControls(form,scope,policy,capabilities={}){
  if(!scope.startsWith('wechat:'))return;
  const field=name=>form.elements.namedItem(name);
  // These controls remain visible so input recognition cannot be confused
  // with voice output, or QQ support with an unverified WeChat transport.
  const mediaReady=capabilities.images&&capabilities.stickers,pluginsReady=capabilities.plugins;
  for(const name of ['voiceMode','pluginsEnabled','pluginMode','pluginCallLimit','pluginCommands','stickers','stickerMode','stickerLibraryId','stickerCooldownSeconds','stickerEdge']){
    const input=field(name);if(!input)continue;const plugin=name.startsWith('plugin');input.disabled=name==='voiceMode'?!capabilities.voice:!(plugin?pluginsReady:mediaReady);input.title=name==='voiceMode'?(capabilities.voice?'Breeze原生语音发送':'请先验收微信原生语音通道'):input.disabled?(plugin?'请先连接微信插件通道':'请先连接已验证的原生媒体通道'):'';
  }
  if(!capabilities.voice)field('voiceMode').value='off';const edgeLabel=field('stickerEdge')?.closest('label');if(edgeLabel?.firstChild?.nodeType===3)edgeLabel.firstChild.textContent='表情最长边';
  const note=document.createElement('p');note.className='footnote';note.textContent=`${mediaReady?'原生图片与GIF表情已就绪':'请先连接原生媒体通道'}；${pluginsReady?'微信插件通道已连接':'微信插件通道尚未连接'}。${capabilities.voice?'原生语音已验收，可按聊天开启':'原生语音通道尚未验收，暂时关闭'}，QQ与微信记忆保持独立。`;form.querySelector('.save-bar').before(note);
  if(scope.includes(':group:')){
    const label=document.createElement('label');label.textContent='允许触发的群成员 wxid（留空为群内全部成员）';const input=document.createElement('input');input.name='allowedSenders';input.value=(policy.allowedSenders??[]).join('，');input.maxLength=8256;label.append(input);form.querySelector('.form-grid').append(label);
  }
}
