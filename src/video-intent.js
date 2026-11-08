export function videoIntent(text){
 const s=String(text??'').trim();
 if(/^\/(?:视频状态|停止刷视频|暂停刷视频|继续刷视频)$/u.test(s))return {action:({'/视频状态':'status','/停止刷视频':'stop','/暂停刷视频':'pause','/继续刷视频':'resume'})[s]};
 if(/^(?:停止|暂停|继续)(?:刷|看)(?:抖音|B站|b站|视频)[。！!]?$/u.test(s))return {action:s.startsWith('停止')?'stop':s.startsWith('暂停')?'pause':'resume'};
 const command=s.startsWith('/刷视频');
 if(!command&&(/^[“"'「『]/u.test(s)||/(?:说过|提到|写着)[：:“"「『]/u.test(s)))return null;
 const main=s.split(/[，,。；;]/u)[0];
 if(!command&&(!/^(?:请|麻烦|帮我|给我|你|快|现在|去|刷|看|我想让你|我希望你)/u.test(main)||!/(?:去|帮我|请|麻烦|你|给我).{0,12}(?:刷|看)|^(?:刷|看)/u.test(main)||/(?:别|不要|不用|不必|不准|假如|假设|如果|有人说|他说|她说|能不能|会不会|能否|怎么|是否)/u.test(main)))return null;
 const platform=/抖音/u.test(s)?'douyin':/(?:B站|b站|哔哩哔哩)/u.test(s)?'bilibili':null;
 const match=s.match(/(?<![.零一二两三四五六七八九十百千万\d])(-?\d{1,3}|[一二三四五六七八九]?十[一二三四五六七八九]?|两|一|二|三|四|五|六|七|八|九)\s*(?:分钟|分鍾)/u),numbers={十:10,两:2,一:1,二:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9};
 if(!platform||!match)return command||platform?{action:'clarify'}:null;
 const value=match[1],parts=value.split('十'),minutes=parts.length===2?(parts[0]?numbers[parts[0]]:1)*10+(parts[1]?numbers[parts[1]]:0):Number(numbers[value]??value);
 if(minutes<1||minutes>30)return {action:'clarify'};
 let query=s.split(/[，,。；;]/u).slice(1).join(' ').replace(/^(?:学(?:习)?一下|看看|了解一下|搜一下|学习|看|了解|搜)[\s，,]*/u,'').replace(/^(?:现在的|目前的)/u,'').trim().slice(0,120);
 if(/^(?:不要|别|不用)/u.test(query))query='';
 if(!query)query=main.slice(match.index+match[0].length).replace(/^(?:的)?(?:抖音|B站|b站|哔哩哔哩)\s*/u,'').replace(/^(?:学(?:习)?一下|看看|了解一下|搜一下|学习|看|了解|搜)\s*/u,'').replace(/^(?:现在的|目前的)/u,'').trim().slice(0,120);
 if(command)query=s.replace(/^\/刷视频\s*/u,'').replace(/(?:抖音|B站|b站|哔哩哔哩)/u,'').replace(match[0],'').trim().slice(0,120);
 return {action:'start',platform,minutes,query};
}
