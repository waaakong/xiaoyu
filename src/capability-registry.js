import fs from 'node:fs';
import {createHash} from 'node:crypto';
// Public descriptions are authored, route discovery only detects unclassified changes.
export const capabilityDefinitions=[
 ['chat','角色聊天',['/api/start','/api/chat/','/api/connect','/api/stop','/api/test-reply','/api/quit'],'当前人格聊天与回复方式'],
 ['voice','语音回复',['/api/voice'],'Breeze语音，支持语音优先与只语音'],
 ['speech','语音识别',['/api/speech'],'本地语音文字与语气线索'],
 ['images','图片与动图理解',['/api/assets/'],'理解可见画面与采样帧'],
 ['memes','表情库与自主收藏',['/api/meme-learning','/api/libraries/','/api/packs/'],'人格选图、来源授权、有限自动收藏'],
 ['memory','记忆与跨聊授权',['/api/memory/','/api/continuity','/api/shared/'],'按来源、聊天与授权回忆'],
 ['context','独立群上下文与回复偏好',['/api/dialogue','/api/history','/api/conversation','/api/source','/api/summary','/api/chat/reply-preference'],'本群话题、摘要、成员与持久回复偏好'],
 ['persona','人格与成长',['/api/personas/','/api/cognition'],'已批准人格、笔记和记忆星图'],
 ['web','原生联网',['/api/web/'],'使用当前引擎原生联网'],
 ['plugins','聊天增强插件',['/api/plugins/'],'AstrBot命令和增强链'],
 ['tasks','定时任务与主动陪伴',['/api/scheduled-tasks','/api/proactive'],'需要明确开关、目标和预算'],
 ['social','引用、拍一拍与转发',['/api/social'],'根据当前平台已核验能力执行'],
 ['video','视频采样观察',['/api/video'],'B站/抖音连续播放和真实进度计时；主人可用文字/语音发起，内容理解仅覆盖采样'],
 ['qzone','QQ空间',['/api/qzone'],'发布或互动需对应授权'],
 ['moments','微信朋友圈',['/api/wechat/moments'],'实验能力；发布前确认与组件核验'],
 ['notebook','人格日记',['/api/notebook'],'本地日记、整理及授权分享'],
 ['self','自我状态与升级感知',['/api/self-model','/api/awareness','/api/emotions','/api/life'],'只读状态、能力、情绪、生活节律与升级记录'],
 ['engines','引擎和额度',['/api/engines'],'Codex/DSH二选一，桥接与模型可用性分开'],
 ['connections','QQ/微信接入与依赖',['/api/state','/api/catalog','/api/contacts','/api/config','/api/connections','/api/wechat','/api/integrations','/api/services','/api/dependencies'],'账号核验、独立启停和依赖'],
 ['appearance','工作台外观与维护',['/api/appearance','/api/backup','/api/maintenance','/api/settings','/api/defaults','/api/setup'],'背景、磨砂和本地管理']
].map(([id,name,prefixes,description])=>({id,name,prefixes,description}));
export function capabilityRegistry(sourceFile){
 const source=fs.readFileSync(sourceFile,'utf8'),routes=[...new Set(source.match(/\/api\/[a-zA-Z0-9][a-zA-Z0-9_/-]*/g)??[])].sort();
 const known=capabilityDefinitions.map(d=>({...d,detected:routes.some(r=>d.prefixes.some(p=>r.startsWith(p)))}));
 const unknown=routes.filter(r=>!known.some(d=>d.prefixes.some(p=>r.startsWith(p))));
 return {routeIds:routes.map(r=>createHash('sha256').update(r).digest('hex').slice(0,12)),known,unknownCount:unknown.length,unknownIds:unknown.map(r=>createHash('sha256').update(r).digest('hex').slice(0,12)),signature:createHash('sha256').update(JSON.stringify({routes,definitions:known.map(({id,name,description,prefixes,detected})=>({id,name,description,prefixes,detected}))})).digest('hex')};
}
