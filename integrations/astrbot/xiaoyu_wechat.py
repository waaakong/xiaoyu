"""Raw-ID WeChat platform. Background sends are denied by Node event leases."""
import asyncio,base64,hmac,json,os,re,uuid
from pathlib import Path
from urllib.parse import unquote,urlparse
from aiohttp import web,WSMsgType
from astrbot.core.platform.platform import Platform
from astrbot.core.platform.register import register_platform_adapter
from astrbot.core.platform.platform_metadata import PlatformMetadata
from astrbot.core.platform.astr_message_event import AstrMessageEvent
from astrbot.core.platform.astrbot_message import AstrBotMessage,MessageMember
from astrbot.core.platform.message_type import MessageType
from astrbot.core.message.components import Plain,At,Image


class WeChatEvent(AstrMessageEvent):
    async def send(self,message):
        raw=self.message_obj.raw_message
        await self.adapter.send_chain(self.get_self_id(),raw['message_type'],raw.get('group_id') or self.get_sender_id(),message,raw.get('xiaoyu_request_id') or raw.get('xiaoyu_lease_id'))
        self._has_send_oper=True


@register_platform_adapter('xiaoyu_wechat','小鱼微信独立授权通道',support_streaming_message=False)
class XiaoyuWeChat(Platform):
    def __init__(self,platform_config,platform_settings,event_queue):
        super().__init__(platform_config,event_queue)
        self.metadata=PlatformMetadata('xiaoyu_wechat','小鱼微信独立授权通道',platform_config['id'],support_streaming_message=False,support_proactive_message=False)
        self.socket=None;self.pending={};self.runner=None;self.stop=asyncio.Event()

    def meta(self):return self.metadata

    def create_event(self,message):
        event=WeChatEvent(message.message_str,message,self.meta(),message.session_id);event.adapter=self;return event

    async def receive(self,request):
        token=os.environ.get('XIAOYU_WECHAT_TOKEN','');account=request.headers.get('X-Self-ID','')
        if len(token)<32 or request.headers.get('Origin') or request.host!='127.0.0.1:6200' or not hmac.compare_digest(request.headers.get('Authorization',''),'Bearer '+token) or not re.fullmatch(r'[-A-Za-z0-9_.]{1,128}',account):raise web.HTTPForbidden()
        if self.socket and not self.socket.closed:raise web.HTTPConflict()
        socket=web.WebSocketResponse(max_msg_size=8*1024*1024,heartbeat=20);await socket.prepare(request);self.socket=socket
        try:
            async for item in socket:
                if item.type!=WSMsgType.TEXT:continue
                try:
                    body=json.loads(item.data)
                    if body.get('echo') in self.pending:
                        future=self.pending[body['echo']]
                        if not future.done():future.set_result(body)
                        continue
                    if body.get('post_type')!='message':continue
                    kind=body.get('message_type');peer=body.get('group_id') if kind=='group' else body.get('user_id')
                    if kind not in ('private','group') or str(body.get('self_id'))!=account or not re.fullmatch(r'[-A-Za-z0-9_@.]{1,128}',str(peer)) or not re.fullmatch(r'[-A-Za-z0-9_.]{1,128}',str(body.get('user_id'))):continue
                    message=AstrBotMessage();message.type=MessageType.GROUP_MESSAGE if kind=='group' else MessageType.FRIEND_MESSAGE
                    message.self_id=account;message.session_id=f'{account}:{kind}:{peer}';message.message_id=str(body['message_id']);message.sender=MessageMember(str(body['user_id']),body.get('sender',{}).get('nickname'));message.group_id=str(peer) if kind=='group' else '';message.raw_message=body
                    message.message=[]
                    for segment in body.get('message',[]):
                        if segment.get('type')=='text':message.message.append(Plain(str(segment['data']['text'])))
                        elif segment.get('type')=='at':message.message.append(At(qq=str(segment['data']['qq'])))
                    message.message_str=''.join(c.text for c in message.message if isinstance(c,Plain));self.commit_event(self.create_event(message))
                except (ValueError,KeyError,TypeError):continue
        finally:
            if self.socket is socket:self.socket=None
            for future in self.pending.values():
                if not future.done():future.set_exception(RuntimeError('微信插件通道已断开'))
        return socket

    async def send_chain(self,account,kind,peer,chain,trace):
        if not self.socket or self.socket.closed:raise RuntimeError('微信插件通道未连接')
        if not isinstance(trace,str) or not re.fullmatch(r'[a-f0-9-]{36}',trace):raise ValueError('微信插件发送缺少本轮租约')
        result=[]
        for component in chain.chain:
            if isinstance(component,Plain):result.append({'type':'text','data':{'text':component.text}})
            elif isinstance(component,At):result.append({'type':'at','data':{'qq':str(component.qq)}})
            elif isinstance(component,Image):
                source=component.file or ''
                if source.startswith('base64://'):encoded=source[9:]
                else:
                    filename=component.path
                    if not filename and source.startswith('file:///'):filename=unquote(urlparse(source).path).lstrip('/')
                    if not filename or not Path(filename).is_absolute() or Path(filename).stat().st_size>5*1024*1024:raise ValueError('微信插件仅接受有界本地或base64图片')
                    encoded=base64.b64encode(Path(filename).read_bytes()).decode()
                if len(encoded)>7*1024*1024:raise ValueError('微信插件图片过大')
                result.append({'type':'image','data':{'file':'base64://'+encoded}})
            else:raise ValueError('微信插件暂不支持该媒体类型')
        echo=str(uuid.uuid4());future=asyncio.get_running_loop().create_future();self.pending[echo]=future
        try:
            await self.socket.send_json({'action':'send','params':{'kind':kind,'peer':str(peer),'message':result,'trace':trace},'echo':echo})
            response=await asyncio.wait_for(future,45)
            if response.get('status')!='ok':raise RuntimeError('微信插件投递未确认，不自动重试')
        finally:self.pending.pop(echo,None)

    async def send_by_session(self,session,message_chain):
        from astrbot.core.platform.astr_message_event import current_message_event
        from xiaoyu_provider import pipeline_owner
        event=current_message_event.get()
        if not isinstance(event,WeChatEvent) or event.session.session_id!=session.session_id or pipeline_owner.get() is not asyncio.current_task():raise RuntimeError('微信后台主动发送默认关闭')
        account,kind,peer=session.session_id.split(':',2)
        raw=event.message_obj.raw_message
        await self.send_chain(account,kind,peer,message_chain,raw.get('xiaoyu_request_id') or raw.get('xiaoyu_lease_id'))

    async def run(self):
        app=web.Application(client_max_size=8*1024*1024);app.router.add_get('/ws',self.receive);self.runner=web.AppRunner(app,access_log=None);await self.runner.setup();await web.TCPSite(self.runner,'127.0.0.1',6200).start()
        try:await self.stop.wait()
        finally:await self.runner.cleanup()

    async def terminate(self):
        self.stop.set()
        if self.socket:await self.socket.close()
