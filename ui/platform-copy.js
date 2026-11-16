// Shared UI copy follows the data platform selected in the workspace.
// Platform switching reloads the page, so reading sessionStorage once at render time is stable.
export const currentPlatform=()=>sessionStorage.getItem('xyPlatform')==='wechat'?'wechat':'qq';
export const isWeChat=()=>currentPlatform()==='wechat';
export const platformName=()=>isWeChat()?'微信':'QQ';
export const accountLabel=()=>isWeChat()?'微信号':'QQ号';
export const peerLabel=()=>isWeChat()?'微信号 / 群 ID':'QQ号 / 群号';
