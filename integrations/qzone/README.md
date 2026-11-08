# 小鱼QQ空间传输

传输模块源自diaomin66/astrbot_plugin_qzone_ultra，保留vendor/LICENSE；下载的逐文件SHA256见vendor/UPSTREAM.json。不是同时安装两个AstrBot插件，也不复用插件后台模型权限。WeChatGirl仅作日记行为参考，没有复制其日记代码。

worker.py仅通过标准输入接收单个请求，无HTTP监听。Cookie由Windows CurrentUser DPAPI保护保存，不交给模型、不进入日志或普通插件网关。HTTP不自动重试；实际对外操作由小鱼的一次性预览确认执行。自动发布、自动评论、自动点赞保持关闭。

依赖中心提供空间组件准备入口，使用既有Python环境；安装时需先停止插件服务，完成后重启。视频仅接收MP4并使用FFmpeg生成本地封面，再上传实际视频和封面。视频发布会创建或复用公开相册、更新动态可见性并读取详情；缺乏同一sVid或公开标记不宣称核验通过，不退回封面图片。

当前本机媒体上限5MB/个；图片最多9张，视频单个独立发布。只实现公开说说，确认界面明确展示。不能把接口可调用、上传完成或请求已接受描述为客户端真实验收。

引用：https://github.com/diaomin66/astrbot_plugin_qzone_ultra ，https://github.com/Zhalslar/astrbot_plugin_qzone （本次直接访问404，仅取得搜索缓存），https://github.com/my12yyds/WeChatGirl/blob/main/docs/plugins/fish-notebook.md
