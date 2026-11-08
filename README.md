# 小鱼 · AI 陪伴工作台

小鱼是面向 Windows 的 Electron 桌面应用，连接个人 QQ、微信与本机 Codex / DeepSeek Harness。支持按聊天授权、多人格、隔离记忆、图片与表情、语音、插件和定时任务。

## 安装

前往 [Releases](https://github.com/waaakong/xiaoyu/releases/latest) 下载 Windows x64 安装程序，按向导选择安装位置和快捷方式。安装包内含 Electron 与 Node.js 24，无需另外安装 Node 或 WebView2。

首次启动按向导配置模型引擎与消息通道。QQ、微信登录由用户在各自客户端完成，聊天需逐个授权。空授权列表不会自动回复。

关闭窗口后收起到托盘，托盘菜单可打开窗口或退出并停止服务。再次启动会恢复已有 Electron 窗口。

当前安装包未做商业代码签名。请从本仓库 Releases 下载，并核对随版本发布的 SHA-256。

## 功能

- QQ 通过 SnowLuma 或 NapCat 接入，微信按客户端版本核验读取与发送组件。
- Codex 与 DSH 双引擎，支持按平台默认值和聊天覆盖选择模型。
- 人格编辑、版本历史、成长审核，以及按聊天隔离的记忆与显式共享。
- 图片理解、表情库、SenseVoice 语音识别与 Breeze 语音输出。
- AstrBot 插件、定时提醒、主动陪伴、角色日记和视频浏览。
- 深浅主题、液态玻璃界面、减少动态效果与低特效模式。

微信原生组件主要针对 Windows 微信 4.2.0.13。其他版本需单独验证。朋友圈发布仍属实验能力，曾出现客户端异常退出，应按对应组件说明有限测试。

## 数据目录

安装版将设置、记忆、数据库和引擎配置保存在用户目录：

`%APPDATA%/小鱼/workspace/`

运行日志位于 `%APPDATA%/小鱼/logs/`。目录名称以 Electron 的用户数据路径为准。卸载默认保留用户数据。手动备份前先通过托盘退出小鱼，避免漏掉 SQLite WAL。

从旧开发目录迁移时，先退出两个版本，再单独备份并核对旧的 `config.json`、`data/` 和自定义 `persona.md`。登录、密钥、绝对路径及原生组件验收需在目标设备重新核验。

## 开发

需要 Windows x64、Node.js 24+、npm 和 Git。

```powershell
npm ci
npm run setup
npm start
```

`npm start` 打开 Electron，`npm run start:web` 提供浏览器开发入口。`npm run start:legacy` 保留历史 WebView2 宿主用于兼容性开发。

DSH 插件专项测试另需安装其依赖：

```powershell
npm ci --prefix integrations/dsh --legacy-peer-deps
npm test
```

## 构建安装向导

```powershell
npm run package:windows
```

生成 `release/xiaoyu-Setup-1.0.0-x64.exe`。构建脚本只收集应用源码、运行依赖和运行时。运行配置、账号认证、数据库、浏览器状态与本机原生验收材料不进入安装包。

Electron 主进程启用 context isolation 与 renderer sandbox，通过 preload 提供受限窗口 API。本机后端使用独立 Node 进程、随机会话令牌与回环地址提供界面资源。

## 第三方组件

保留源文件和依赖中的许可证与声明。界面使用 GSAP，部分控件参考 MoYu-Station，声明见 `ui/GSAP-NOTICE.txt`、`ui/MOYU-NOTICE.txt`。微信和 QQ 空间集成保留各自上游来源及许可证。
