export function addVoiceMode(form,policy){
  const label=document.createElement('label');label.textContent='语音回复';const select=document.createElement('select');select.name='voiceMode';for(const [value,name]of [['off','关闭'],['requested','明确要求才发（仅语音）'],['always','文字＋语音'],['only','只语音回复']]){const option=document.createElement('option');option.value=value;option.textContent=name;select.append(option);}select.value=policy.voiceMode??'off';label.append(select);const hint=document.createElement('small');hint.className='voice-mode-hint';hint.style.cssText='display:block;font-size:12px;line-height:1.5;font-weight:400;white-space:normal';hint.textContent='只语音会消耗Breeze额度：语音回答不附正文，表情仍按聊天设置发送；合成失败仅提示，投递未知不重发。';label.append(hint);form.querySelector('.form-grid').append(label);
}

export {createVoiceUI} from './breeze-voice-ui.js';
