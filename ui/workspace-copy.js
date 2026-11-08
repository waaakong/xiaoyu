// Shared navigation and page introductions. Status and operation results remain
// owned by their feature modules, so copy never invents a successful connection.
export const workspacePages = {
  overview: ['总览', '工作台总览', '检查 QQ、微信和模型连接，查看当前数据空间的授权情况。'],
  chats: ['聊天与授权', '聊天与授权', '选择联系人或群聊，开启回复并设置专属人格、模型和记忆权限。'],
  personas: ['人格与角色', '人格与角色', '编辑角色的性格与表达方式，再为每个聊天选择合适的人格。'],
  assets: ['图片与表情', '图片与表情', '管理本地图库、导入表情包，并在聊天设置中选择发送方式。'],
  proactive: ['主动陪伴', '社交与主动陪伴', '管理主动接话与社交互动。各项操作遵循聊天授权和实际通道能力。'],
  life: ['生活节律', '生活节律', '查看角色的作息、活动和持续状态；这些记录不代表用户的真实生理状态。'],
  video: ['视频浏览', '视频浏览', '通过专用浏览器查看 B站与抖音内容，区分字幕、采样画面和未观察的部分。'],
  qzone: ['QQ 空间', 'QQ 空间', '管理角色的空间内容与发布草稿。发布、点赞和评论需单独确认。'],
  moments: ['微信朋友圈', '微信朋友圈', '查看朋友圈接入与本地草稿。发布前确认内容，原生能力需在当前客户端验证。'],
  cognition: ['记忆总览', '记忆总览', '查看当前平台的记忆、笔记与学习记录；浏览这些数据不会调用模型。'],
  starMap: ['记忆星图', '记忆星图', '沿着人物、故事与关联，找到记忆及其来源。'],
  memories: ['记忆库', '记忆库', '查看和管理聊天中保留的事实、偏好与共同经历。'],
  people: ['人物记忆', '人物记忆', '按聊天和人格查看人物信息，追溯每条记录的来源。'],
  notebook: ['角色笔记', '角色笔记', '管理本地笔记与旧版日记，按聊天和人格保留内容归属。'],
  diary: ['角色日记', '角色日记', '按聊天、人格和北京时间日期整理日记。记录保存在本机。'],
  knowledge: ['知识与关系', '知识与关系', '整理知识资料及其关联，在需要时查看来源。'],
  continuity: ['跨聊共享', '跨聊共享', '管理明确发布给其他聊天的续聊内容；原始对话不会自动跨聊。'],
  learning: ['学习与审核', '学习与审核', '查看学习结果、审核变更建议，并管理人格草稿与版本。'],
  recall: ['记忆检索调试', '记忆检索调试', '检查记忆召回的范围、来源和结果，帮助定位上下文问题。'],
  wechatConnection: ['微信接入', '微信接入', '分别核验客户端、账号、读取和发送能力，再为聊天开启回复。'],
  integrations: ['QQ 接入', 'QQ 接入', '配置 SnowLuma 或 NapCat，检查账号和协议连接，再授权聊天。'],
  engines: ['引擎与额度', '引擎与额度', '管理 Codex 与 DSH 的连接、默认引擎及可查询的额度。'],
  models: ['模型目录', '模型目录', '查看引擎实际返回的模型，在聊天中独立选择使用。'],
  voice: ['语音与音色', '语音与音色', '配置 Breeze 语音输出、角色音色和表达模板；语音识别单独设置。'],
  web: ['联网搜索', '联网搜索', '使用所选引擎的搜索与网页读取能力，按聊天开启。'],
  plugins: ['插件管理', '插件管理', '管理 AstrBot 插件环境与聊天权限，选择命令模式或增强模式。'],
  dependencies: ['环境与依赖', '环境与依赖', '检测本机环境，按需准备 Python、AstrBot 和语音相关依赖。'],
  companion: ['状态与情绪', '状态与情绪', '查看本机程序状态与当前聊天中的角色心情。'],
  usage: ['运行与用量', '运行与用量', '查看请求、投递结果和模型用量，定位等待或失败的环节。'],
  maintenance: ['备份与维护', '备份与维护', '备份、整理或清理当前平台的数据，操作前核对具体范围。'],
  settings: ['设置', '设置', '调整当前平台的聊天默认值、连接参数和本机外观。']
};

export function applyPageIntroduction(page) {
  const copy = workspacePages[page.id];
  if (!copy) return;
  const title = page.querySelector('h1');
  if (!title) return;
  if (title.textContent !== copy[1]) title.textContent = copy[1];
  const heading = title.closest('.heading, .wechat-heading, .star-heading');
  const intro = heading?.querySelector('p:not(.star-eyebrow)') ??
    (title.nextElementSibling?.matches('p') ? title.nextElementSibling : null);
  // Contact status is live account data, not a static page description.
  if (intro && intro.id !== 'contactStatus' && intro.textContent !== copy[2]) intro.textContent = copy[2];
}
