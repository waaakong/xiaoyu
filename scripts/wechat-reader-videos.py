"""Bind inbound video IDs to exact authorized messages and local account cache."""
import base64, hashlib, json, re
import xml.etree.ElementTree as ET
from pathlib import Path

def video_md5(text):
    if not isinstance(text,str) or len(text)>100000 or re.search(r'<!DOCTYPE|<!ENTITY',text,re.I):return None
    try:
        node=ET.fromstring(text).find('.//videomsg')
        value=node.get('md5','') if node is not None else ''
        return value.lower() if re.fullmatch(r'[a-fA-F0-9]{32}',value) else None
    except ET.ParseError:return None

def cached_video(account,md5):
    # Never follow a path supplied by the message XML. Verify content digest too.
    root=(Path(account)/'msg'/'video').resolve(strict=True)
    count=0
    for file in root.rglob('*.mp4'):
        count+=1
        if count>20000:break
        if file.stem.lower()!=md5:continue
        target=file.resolve(strict=True)
        if not target.is_relative_to(root) or not target.is_file() or not 0<target.stat().st_size<=50*1024*1024:continue
        raw=target.read_bytes()
        if hashlib.md5(raw).hexdigest()==md5:return raw
    raise ValueError('视频尚未下载到本机缓存，请在微信下载原视频后重新发送')

def install(module):
    original_dict=module.nt._message_dict
    def message_dict(row,*args,**kwargs):
        result=original_dict(row,*args,**kwargs)
        if result.get('localType') in (43,62):
            text=module.nt._decode_content(row.get('message_content'))
            if isinstance(text,str):
                at=text.find('<msg')
                if at>=0:result['videoMd5']=video_md5(text[at:])
        return result
    module.nt._message_dict=message_dict
    original=module.Reader.make_payload
    def make_payload(self,talker,message):
        if message.get('localType') not in (43,62):return original(self,talker,message)
        # Use upstream identity/sender validation and authenticated mention metadata.
        clone={**message,'localType':1,'fullText':'[用户发送了视频]','content':'[用户发送了视频]'}
        result=original(self,talker,clone)
        if not result or talker not in self.selected_talkers():return None
        descriptor={'talker':talker,'sender':message.get('senderUsername'),'md5':message.get('videoMd5'),'account':self.own_wxid}
        video_id=hashlib.sha256(json.dumps([result['rawid'],descriptor],sort_keys=True).encode()).hexdigest()
        if not hasattr(self,'xiaoyu_videos'):self.xiaoyu_videos={}
        self.xiaoyu_videos[video_id]=descriptor
        while len(self.xiaoyu_videos)>256:self.xiaoyu_videos.pop(next(iter(self.xiaoyu_videos)))
        return {**result,'type':43,'video':{'id':video_id}}
    module.Reader.make_payload=make_payload
    # Reuse the reader's authenticated binary-data route without modifying upstream files.
    original_resolve=module.Reader.resolve_image
    def resolve(self,identifier):
        descriptor=getattr(self,'xiaoyu_videos',{}).get(identifier)
        if descriptor is None:return original_resolve(self,identifier)
        if descriptor['account']!=self.own_wxid or not self.image_talker_allowed(descriptor['talker']):raise PermissionError('Video is not authorized')
        if not descriptor['md5']:raise ValueError('视频缺少可核验缓存标识')
        return {'success':True,'kind':'xiaoyu-chat-video','b64':base64.b64encode(cached_video(self.account,descriptor['md5'])).decode()}
    module.Reader.resolve_image=resolve

    original_messages=module.Reader.messages
    def messages(self,talker,*args,**kwargs):
        rows=original_messages(self,talker,*args,**kwargs)
        for row in rows:
            if row.get("localType") not in (3,47,43,62) or row.get("isSend"):continue
            payload=self.make_payload(talker,row)
            if not payload:continue
            if payload.get("image"):
                if not self.image_talker_allowed(talker):continue
                identifier=hashlib.sha256(json.dumps([self.own_wxid,talker,payload["rawid"]]).encode()).hexdigest()
                descriptor={"talker":talker,**payload["image"],"account":self.account.name,"sender":payload["talkerId"]}
                with self.lock:
                    self.image_index[identifier]=descriptor
                    while len(self.image_index)>1000:self.image_index.pop(next(iter(self.image_index)))
                payload["image"]["id"]=identifier
            row["xiaoyuMediaPayload"]=payload
        return rows
    module.Reader.messages=messages
