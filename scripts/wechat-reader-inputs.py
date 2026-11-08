"""Xiaoyu-only voice grants and structured mention metadata; no upstream edits."""
import json
from pathlib import Path
import re
import sys
import xml.etree.ElementTree as ET


def mentions(message):
    found=set()
    for name in ('atUserIds','mentions'):
        if isinstance(message.get(name),list):
            found.update(value for value in message[name] if isinstance(value,str) and re.fullmatch(r'[-A-Za-z0-9_]{1,128}',value))
    # Never interpret user text/fullText as authenticated mention metadata.
    for name in ('msgSource','messageSource','msg_source','sourceXml'):
        value=message.get(name)
        if not isinstance(value,str) or len(value)>100000 or re.search(r'<!DOCTYPE|<!ENTITY',value,re.I):continue
        try:
            root=ET.fromstring(value)
            for item in root.iter('atuserlist'):
                found.update(part.strip() for part in (item.text or '').split(',') if re.fullmatch(r'[-A-Za-z0-9_]{1,128}',part.strip()))
        except ET.ParseError:pass
    return sorted(found)


def audio_allowed(root,key,plugin_id,reader):
    if reader is None or plugin_id not in ('speech-recognition','xiaoyu-local-speech') or not re.fullmatch(r'wechat:(private|group):[1-9]\d*',key or ''):return False
    try:
        root=Path(root)
        grants=json.loads((root/'state/xiaoyu-input-grants.json').read_text(encoding='utf-8-sig'))
        if grants.get('version')!=1 or grants.get('account')!=reader.own_wxid or grants.get('accountDirectory')!=Path(reader.account).name or key not in grants.get('audioKeys',[]):return False
        project=json.loads((root/'config/wechatagent.json').read_text(encoding='utf-8-sig'))
        kind,peer=key.split(':')[1:]
        return peer in map(str,project.get('wechat',{}).get('whitelist',{}).get('groups' if kind=='group' else 'private',[]))
    except (OSError,ValueError,AttributeError,TypeError):return False


def install(module,root):
    bound=[None]
    voice=sys.modules['wechat_voice_input']
    voice.audio_policy=lambda base,key,plugin_id='speech-recognition':audio_allowed(base,key,plugin_id,bound[0])
    # The NT reader originally discards the DB's compressed source column.
    # Read only that metadata column through its existing query-only path.
    module.nt.MESSAGE_COLUMNS=tuple(dict.fromkeys((*module.nt.MESSAGE_COLUMNS,'source')))
    original_message=module.nt._message_dict
    def message_dict(row,sender_map,names,own,is_group=False):
        result=original_message(row,sender_map,names,own,is_group)
        if result.get('localType')==3:
            content=module.nt._decode_content(row.get('message_content'))
            if isinstance(content,str) and len(content)<=100000:
                if is_group:content=module.nt._strip_group_speaker(content,set(names)|{result.get('senderUsername','')})
                if not re.search(r'<!DOCTYPE|<!ENTITY',content,re.I):
                    try:
                        image=ET.fromstring(content).find('.//img')
                        md5=image.get('md5','') if image is not None else ''
                        if re.fullmatch(r'[a-fA-F0-9]{32}',md5):result['imageMd5']=md5.lower()
                    except ET.ParseError:pass
        if is_group:
            source=module.nt._decode_content(row.get('source'))
            if isinstance(source,str) and len(source)<=100000:result['msgSource']=source
        return result
    module.nt._message_dict=message_dict
    original=module.Reader.make_payload
    def make_payload(self,talker,message):
        result=original(self,talker,message)
        if result:
            value=str(message.get('serverId') or '')
            if re.fullmatch(r'-?[0-9]{1,20}',value) and 0 < (int(value) & ((1<<64)-1)) < (1<<64):result['serverId']=str(int(value) & ((1<<64)-1))
            users=mentions(message)
            if users:result['atUserIds']=users
        return result
    module.Reader.make_payload=make_payload
    return lambda reader:bound.__setitem__(0,reader)
