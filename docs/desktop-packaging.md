# Windows Electron 桌面发行

开发启动使用 npm start。安装向导使用 electron-builder NSIS，允许选择目录，并创建开始菜单与桌面入口。

运行 npm run package:windows 生成 release 目录中的 x64 安装器。安装版包含 Electron 和官方 Node.js 运行时，后端源码及依赖位于 resources/backend，启动后同步到 app.getPath('userData')/workspace。配置、数据库与日志存放在用户目录，安装目录无需写入权限。卸载保留数据。

窗口启用 contextIsolation、sandbox，禁用 renderer Node 集成。窗口操作通过 preload 与受限 IPC 完成。主窗口限制在本机随机端口的界面来源，插件与协议面板限制到已配置的本机管理端口。

退出通过托盘菜单完成，并等待后端释放数据库与通道。关闭窗口收起到托盘。重复启动通过 Electron 单实例锁恢复窗口。

--smoke-test --data-dir=<临时目录> 可验证打包后的真实启动。测试禁用自动模型连接，写出 electron-smoke.json 和 electron-smoke.png，然后退出。此参数用于独立验收目录。

安装包发布时附 SHA256SUMS.txt。未配置代码签名证书的构建会显示未知发布者。旧 WebView2 源码保留为兼容开发入口，安装发行入口使用 Electron。
