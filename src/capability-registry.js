import fs from 'node:fs';
import {createHash} from 'node:crypto';
// Public descriptions are authored, route discovery only detects unclassified changes.
export const capabilityDefinitions=[
 ['chat','角色聊天',['/api/start','/api/chat/','/api/connect','/api/stop','/api/test-reply','/api/quit'],'当前人格聊天与回复方式','toggle',['按人格生成回复','同成员连续文字和图片静默收齐，其他聊天与成员隔离','日常口语与任务格式分开，情绪影响意群长短','默认1至8秒反应目标，模型耗时计入等待，精力影响节奏','阻止尚未提交的过时回复','查询当前聊天开关']],
 ['voice','语音回复',['/api/voice'],'Breeze语音，支持语音优先与只语音','toggle',['用Breeze合成语音','语音优先或只语音回复','文字与语音共用本轮表达情绪，旧模板可回退','检查语音组件与绑定状态']],
 ['speech','语音识别',['/api/speech'],'本地语音文字与语气线索','toggle',['识别语音消息文字','提取语气线索','检查本地识别环境']],
 ['images','图片与动图理解',['/api/assets/'],'理解可见画面与采样帧','toggle',['理解聊天图片','理解表情与动图','按采样帧理解视频画面']],
 ['memes','表情库与自主收藏',['/api/meme-learning','/api/libraries/','/api/packs/'],'人格选图、来源授权、有限自动收藏','toggle',['按人格与气氛选图','从授权来源收藏表情','查询表情库与来源']],
 ['memory','记忆与跨聊授权',['/api/memory/','/api/memory-archive/','/api/continuity','/api/shared/'],'按来源、聊天与授权回忆','always',['按聊天召回长期事实','查询近期原文与阶段摘要','区分记忆来源与授权','本地记忆档案与候选审核','按预算整理历史重要记忆','可选本地语义索引与日记检索','星图查看真实来源和最近召回']],
 ['context','独立群上下文与回复偏好',['/api/dialogue','/api/history','/api/conversation','/api/source','/api/summary','/api/chat/reply-preference'],'本群话题、摘要、成员与持久回复偏好','toggle',['维护本群话题与摘要','识别成员与回复偏好','按聊天隔离上下文']],
 ['persona','人格与成长',['/api/personas/','/api/cognition'],'已批准人格、笔记和记忆星图','always',['读取已批准人格','查看人格笔记','查看记忆星图']],
 ['web','原生联网',['/api/web/'],'使用当前引擎原生联网','toggle',['使用引擎原生联网','查询网页资料','检查联网开关']],
 ['plugins','聊天增强插件',['/api/plugins/'],'AstrBot命令和增强链','toggle',['执行AstrBot命令','调用增强插件链','查看插件连接状态']],
 ['tasks','定时任务与主动陪伴',['/api/scheduled-tasks','/api/proactive'],'需要聊天授权，黑名单优先，并受执行及模型预算限制','toggle',['按聊天允许非黑名单成员创建任务','北京时间一次、每天或每周固定正文及人格问候','任务编辑、暂停、取消及从下一周期恢复','按预算执行主动陪伴']],
 ['social','引用、拍一拍与转发',['/api/social'],'根据当前平台已核验能力执行','toggle',['引用回复','发送或回应拍一拍','转发消息']],
 ['chat-video','聊天视频理解',['/api/catalog'],'QQ/微信视频本地抽帧，文字视频一起收齐；默认3分钟50MB，6帧合成2张时间图，音轨可选前60秒','toggle',['每聊天chatVideos开关','videoAudio本地转写默认关闭','长视频随原视频指定：视频片段 0-60秒']],
 ['video','视频采样观察',['/api/video'],'B站/抖音连续播放和真实进度计时；主人可用文字/语音发起，内容理解仅覆盖采样','toggle',['按真实播放进度计时','连续换片与去重','按采样帧理解视频']],
 ['qzone','QQ空间',['/api/qzone'],'发布或互动需对应授权','toggle',['发布QQ空间动态','互动前核对授权','查询空间开关']],
 ['moments','微信朋友圈',['/api/wechat/moments'],'界面自动化发布文字、图片、视频和可见范围；发布前逐次确认','experimental',['界面发布文字朋友圈','界面发布图片或视频','设置公开或私密可见','每日随机发一条文字']],
 ['notebook','人格日记',['/api/notebook'],'本地日记持久队列、跨日恢复、7天漏写清单及授权分享','toggle',['写人格日记','查看整理暂停原因与模型尝试次数','勾选历史日期确认后补写','经授权分享日记']],
 ['self','自我状态与升级感知',['/api/self-model','/api/awareness','/api/emotions'],'只读状态、能力、情绪与升级记录','always',['查询自身状态与情绪','查询功能目录','查看升级感知']],
 ['life','生活节律与状态通知',['/api/life'],'按作息调整活跃度，可把任务状态通知到已授权聊天','toggle',['按作息调整活跃度','到点状态通知','查询生活节律设置']],
 ['engines','引擎和额度',['/api/engines'],'Codex/DSH二选一，桥接与模型可用性分开','always',['切换Codex或DSH','查看模型连接状态','查询引擎额度']],
 ['connections','QQ/微信接入与依赖',['/api/state','/api/catalog','/api/contacts','/api/config','/api/connections','/api/wechat','/api/integrations','/api/services','/api/dependencies'],'账号核验、独立启停和依赖','always',['核验QQ账号','核验微信账号','独立启停接入与依赖']],
 ['appearance','工作台外观与维护',['/api/appearance','/api/backup','/api/maintenance','/api/settings','/api/defaults','/api/setup'],'背景、磨砂和本地管理','always',['切换工作台背景','调整磨砂外观','备份与本地维护']]
].map(([id,name,prefixes,description,mode,actions])=>({id,name,prefixes,description,mode,actions:Array.isArray(actions)?actions.slice(0,4):[]}));
export function capabilityRegistry(sourceFile){
 const source=fs.readFileSync(sourceFile,'utf8'),routes=[...new Set(source.match(/\/api\/[a-zA-Z0-9][a-zA-Z0-9_/-]*/g)??[])].sort();
 const known=capabilityDefinitions.map(d=>({...d,detected:routes.some(r=>d.prefixes.some(p=>r.startsWith(p)))}));
 const unknown=routes.filter(r=>!known.some(d=>d.prefixes.some(p=>r.startsWith(p))));
 return {routeIds:routes.map(r=>createHash('sha256').update(r).digest('hex').slice(0,12)),known,unknownCount:unknown.length,unknownIds:unknown.map(r=>createHash('sha256').update(r).digest('hex').slice(0,12)),signature:createHash('sha256').update(JSON.stringify({routes,definitions:known.map(({id,name,description,prefixes,mode,actions,detected})=>({id,name,description,prefixes,mode,actions,detected}))})).digest('hex')};
}
