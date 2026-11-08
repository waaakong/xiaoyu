# AstrBot兼容性验收样例

`xiaoyu_image_test/`为本项目维护的接口测试插件，只读取同目录fixture.png生成消息，不调用模型或外部网络。将该目录复制到独立AstrBot的data/plugins后，由真实AstrBot加载；修改代码后需重载或重启AstrBot。小鱼按聊天允许命令`xyimage`后才转发。

生态插件验收使用官方https://github.com/Soulter/helloworld 的main.py、metadata.yaml和LICENSE，保持原文件不修改。它是AGPL许可的独立AstrBot插件，不嵌入小鱼Node主模块。实际安装副本在项目data/astrbot/data/plugins/helloworld。

独立环境准备流程：使用官方Python>=3.12，在项目独立环境安装固定`astrbot==4.29.4`。`scripts/prepare-astrbot.py`只初始化本项目data/astrbot配置；通过标准输入接收与小鱼SQLite内plugin-gateway-token一致的私有令牌，不在命令行参数或日志打印令牌。已有配置会拒绝覆盖，日后通过AstrBot原生面板管理。

运行`scripts/verify-astrbot.mjs`前启动独立AstrBot（可在小鱼插件页启动）。该脚本使用虚构QQ99、成员10、群20与模拟动作出口，验证真实Python插件，不发送真实QQ、不调用模型。它不会替代真实QQ验收。结果保存在data/astrbot-plugin-verification.json。

没有当前授权命令，网关拒绝插件后台发送；其他成员/群、群管理、文件路径和远程图片URL也不开放。插件本身是受信任的本机代码，这些OneBot出口约束不是进程沙箱。
