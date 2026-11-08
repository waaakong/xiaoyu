// Stable dsh-emoji-core@1 keys. Labels/search terms are maintained locally.
export const EMOJI_KEY_SET='dsh-emoji-core@1';
export const EMOJI_CORE=[
 ['happy','开心','happy','😊','微笑 欢迎 高兴'],['sad','难过','sad','😢','伤心 失落'],['confused','疑惑','confused','😕','问号 不懂'],['watching','围观','daily','👀','吃瓜 看戏'],
 ['angry','生气','angry','😠','愤怒 不满'],['speechless','无语','confused','😑','沉默 尴尬'],['doge','狗头','happy','😉','玩笑 调侃'],['overloaded','过载','confused','😵‍💫','宕机 烧脑'],
 ['neutral','平静','daily','😐','中性 普通'],['laughing','大笑','happy','😆','哈哈 好笑'],['crying','大哭','sad','😭','哭泣 呜呜'],['sweating','流汗','confused','😅','紧张 心虚'],
 ['thinking','思考','confused','🤔','考虑 分析'],['okay','好的','daily','👌','OK 收到'],['nodding','点头','daily','🙂‍↕️','明白 同意'],['sleeping','睡觉','daily','😴','晚安 困了'],
 ['hurt','委屈','sad','🥺','受伤 难受'],['peeking','偷看','shy','🫣','窥屏 偷瞄'],['approve','赞同','happy','👍','点赞 支持'],['heart','比心','happy','🫶','爱心 喜欢'],
 ['shy','害羞','shy','😳','脸红 腼腆'],['star-eyes','星星眼','happy','🤩','崇拜 惊艳'],['laugh-cry','笑哭','happy','😂','笑出眼泪'],['touched','感动','happy','🥹','暖心 热泪'],
 ['scared','害怕','confused','😱','惊恐 惊吓'],['facepalm','捂脸','confused','🤦','没眼看'],['eye-roll','白眼','angry','🙄','嫌弃'],['sigh','叹气','sad','😮‍💨','无奈 心累'],
 ['frustrated','抓狂','angry','😫','烦躁 崩溃'],['playful','调皮','happy','😜','吐舌 逗趣'],['snickering','偷笑','happy','🤭','嘿嘿 窃笑'],['sarcastic','呵呵','angry','😏','阴阳 冷笑'],
 ['cool','酷','happy','😎','墨镜 自信'],['celebrate','庆祝','happy','🎉','撒花 恭喜'],['cheer','加油','happy','💪','鼓励 打气'],['thanks','谢谢','happy','🙏','感谢 辛苦'],
 ['sorry','抱歉','sad','🙇','对不起 认错'],['hug','抱抱','shy','🤗','拥抱 安慰'],['please','拜托','daily','🤲','请求 求求'],['applause','鼓掌','happy','👏','掌声 祝贺']
].map(([key,label,mood,unicode,terms])=>({key,label,mood,unicode,terms:terms.split(' ')}));
export const EMOJI_BY_KEY=new Map(EMOJI_CORE.map(e=>[e.key,e]));
export const EMOJI_VERSION=/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?:0|[1-9]\d*|[\da-z-]*[a-z-][\da-z-]*)(?:\.(?:0|[1-9]\d*|[\da-z-]*[a-z-][\da-z-]*))*)?(?:\+[\da-z-]+(?:\.[\da-z-]+)*)?$/i;
