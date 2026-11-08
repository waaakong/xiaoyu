"""Single-request Qzone transport. Credentials use Windows CurrentUser DPAPI.

No listener, arbitrary URL, retries, model access or background automation.
"""
import asyncio
import contextlib
import ctypes
from ctypes import wintypes
import json
import logging
import os
import re
import shutil
import subprocess
import time
import traceback
from urllib.parse import urlparse
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).parent / 'vendor'))
logging.disable(logging.CRITICAL)

def response_json(payload):
    # -I ignores PYTHONUTF8 on Windows; keep the wire ASCII-safe under GBK consoles.
    return json.dumps(payload,ensure_ascii=True)

def ffmpeg_path():
    executable=shutil.which('ffmpeg')
    if executable:return executable
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except ImportError:return None

def system_proxy():
    if os.name!='nt':return None
    try:
        import winreg
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER,r'Software\Microsoft\Windows\CurrentVersion\Internet Settings') as key:
            if winreg.QueryValueEx(key,'ProxyEnable')[0]!=1:return None
            raw=winreg.QueryValueEx(key,'ProxyServer')[0]
        if '=' in raw:
            entries=dict(piece.split('=',1) for piece in raw.split(';') if '=' in piece)
            raw=entries.get('https') or entries.get('http') or ''
        url=raw if '://' in raw else 'http://'+raw
        parsed=urlparse(url)
        if parsed.scheme in ('http','https') and parsed.hostname in ('127.0.0.1','localhost','::1') and not parsed.username and not parsed.password:return url
    except (OSError,ValueError):pass
    return None

def values_for(payload, keys):
    values=[]
    def walk(value, depth=0):
        if depth>16:return
        if isinstance(value,dict):
            for key,item in value.items():
                if key in keys:values.append(item)
                if isinstance(item,(dict,list)):walk(item,depth+1)
        elif isinstance(value,list):
            for item in value[:200]:walk(item,depth+1)
    walk(payload)
    return values

async def verify_video_resource(client,vid):
    payload=await client.video_get_data(client.login_uin,get_method=2,start=0,count=20,need_old=1,get_user_info=1)
    matches=[]
    def walk(value,depth=0):
        if depth>12:return
        if isinstance(value,dict):
            encoded=json.dumps(value,ensure_ascii=False)
            if vid in encoded:
                urls=[]
                for url in re.findall(r'https?://[^\s"<>\\]+',encoded.replace('\\/','/')):
                    if urlparse(url).hostname=='photovideo.photo.qq.com':urls.append(url)
                if urls:matches.append((len(encoded),value,urls))
            for item in value.values():walk(item,depth+1)
        elif isinstance(value,list):
            for item in value[:100]:walk(item,depth+1)
    walk(payload)
    for _,item,urls in sorted(matches,key=lambda m:m[0])[:1]:
        is_public=any(str(v)=='0' for v in values_for(item,{'priv'})) or any(str(v)=='3' for v in values_for(item,{'accessright'}))
        if not is_public:continue
        for url in urls[:2]:
            # Public CDN probe carries no QQ Cookie or authorization header.
            if url.startswith('http://'):url='https://'+url[7:]
            probe=await public_video_probe(url)
            if probe['readable']:return {'sameVideo':True,'publicVerified':True,'source':'video_get_data/public-cdn','vid':vid,'httpStatus':probe['httpStatus'],'contentType':probe['contentType']}
    return {'sameVideo':bool(matches),'publicVerified':False,'source':'video_get_data','vid':vid}

async def public_video_probe(url):
    import httpx
    if urlparse(url).hostname!='photovideo.photo.qq.com':raise RuntimeError('PUBLIC_CDN_HOST_REQUIRED')
    # A fresh client cannot inherit the authenticated client's Cookie jar.
    async with httpx.AsyncClient(proxy=system_proxy(),trust_env=False,follow_redirects=False,timeout=15,headers={'Range':'bytes=0-0'}) as public:
        response=await public.get(url)
        content_type=response.headers.get('content-type','').lower()
        return {'readable':response.status_code in (200,206) and (content_type.startswith('video/') or 'octet-stream' in content_type),'httpStatus':response.status_code,'contentType':content_type}

async def publish_video(client,p):
    executable=ffmpeg_path()
    if not executable:raise RuntimeError('VIDEO_FFMPEG_REQUIRED')
    path=Path(p['video']);cover=path.with_suffix('.cover.jpg')
    # This creates a local cover only. A successful thumbnail never counts as a video post.
    probe=subprocess.run([executable,'-nostdin','-hide_banner','-i',str(path),'-frames:v','1','-y',str(cover)],check=True,timeout=40,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
    duration=re.search(rb'Duration: (\d+):(\d+):(\d+(?:\.\d+)?)',probe.stderr)
    if not duration:raise RuntimeError('VIDEO_METADATA_INVALID')
    hours,minutes,seconds=map(float,duration.groups());duration_ms=int((hours*3600+minutes*60+seconds)*1000)
    if duration_ms<=0:raise RuntimeError('VIDEO_METADATA_INVALID')
    album=await client.ensure_public_video_album()
    album_id=str(album.get('id') or album.get('topicId') or album.get('albumId') or album.get('albumid') or album.get('aid') or '')
    if not album_id:raise RuntimeError('VIDEO_ALBUM_NOT_VERIFIED')
    upload_time=int(time.time());client_key=os.urandom(12).hex()
    result=await client.upload_h5_video(path,title=path.name,desc=p['text'],play_time=duration_ms,upload_time=upload_time,extend_info={'clientkey':client_key})
    await client.upload_h5_video_cover(cover,vid=result.vid,video_path=path,client_key=client_key,upload_time=upload_time,video_size=path.stat().st_size,duration_ms=duration_ms,desc=p['text'],album_id=album_id,album_name=str(album.get('name') or '小鱼视频'),album_type_id=0)
    response=await client.publish_video_mood(p['text'],vid=result.vid)
    fids=values_for(response,{'tid','fid'})
    fid=str(next((x for x in fids if isinstance(x,(str,int)) and str(x)),''))
    if not fid:return {'serverAccepted':True,'verified':False,'vid':result.vid,'notice':'视频已提交，未取得动态ID；请核对，不重发'}
    await client.update_mood_visibility_public(fid,content=p['text'],vid=result.vid)
    detail=await client.detail(client.login_uin,fid)
    same_video=result.vid in [str(v) for v in values_for(detail,{'vid','sVid','svid','video_id','videoId','videoid','vidid'})]
    public=any(str(v)=='1' for v in values_for(detail,{'ugc_right','who'})) or any(v is True for v in values_for(detail,{'is_public','isPublic'}))
    if not same_video:
        try:
            proof=await verify_video_resource(client,result.vid)
            same_video=proof['sameVideo'];public=public and proof['publicVerified']
        except Exception:pass
    return {'serverAccepted':True,'verified':same_video and public,'fid':fid,'vid':result.vid,'publicVerified':public,'sameVideoVerified':same_video}

def crypt(data, decrypt=False):
    if os.name != 'nt':
        raise RuntimeError('WINDOWS_REQUIRED')
    class Blob(ctypes.Structure):
        _fields_=[('size',wintypes.DWORD),('data',ctypes.POINTER(ctypes.c_ubyte))]
    buffer=ctypes.create_string_buffer(data)
    source=Blob(len(data),ctypes.cast(buffer,ctypes.POINTER(ctypes.c_ubyte)))
    output=Blob()
    function=ctypes.windll.crypt32.CryptUnprotectData if decrypt else ctypes.windll.crypt32.CryptProtectData
    if not function(ctypes.byref(source),None,None,None,None,1,ctypes.byref(output)):
        raise RuntimeError('CREDENTIAL_PROTECTION_FAILED')
    try:return ctypes.string_at(output.data,output.size)
    finally:ctypes.windll.kernel32.LocalFree(output.data)

async def run(body):
    from qzone_bridge.client import QzoneClient
    from qzone_bridge.models import SessionState
    from qzone_bridge.parser import parse_cookie_text, normalize_uin, extract_feed_page
    operation=body['operation']; file=Path(body['credentialFile']); expected=int(body['account'])
    if operation=='unbind':
        file.unlink(missing_ok=True)
        return {'bound':False}
    if operation=='bind':
        cookies=parse_cookie_text(body['cookies'])
    else:
        if not file.is_file():raise RuntimeError('NOT_BOUND')
        saved=json.loads(crypt(file.read_bytes(),True))
        if saved.get('account')!=expected:raise RuntimeError('ACCOUNT_MISMATCH')
        cookies=saved['cookies']
    if normalize_uin(cookies)!=expected or not (cookies.get('p_skey') or cookies.get('skey')):
        raise RuntimeError('ACCOUNT_MISMATCH_OR_COOKIE_INCOMPLETE')
    client=QzoneClient(SessionState(uin=expected,cookies=cookies),max_retries=1)
    proxy=system_proxy()
    if proxy:
        import httpx
        await client._client.aclose()
        client._client=httpx.AsyncClient(proxy=proxy,timeout=15,follow_redirects=False,trust_env=False,headers={'User-Agent':client.user_agent})
    p=body.get('params') or {}
    try:
        if operation in ('bind','status'):
            # The old /mqzone/index page now redirects to the PC homepage.
            # Validate an authenticated, own-account read instead of treating that page as login proof.
            await client.get_visitors(count=1)
            if operation=='bind':
                file.parent.mkdir(parents=True,exist_ok=True)
                temporary=file.with_suffix('.tmp')
                temporary.write_bytes(crypt(json.dumps({'account':expected,'cookies':client.session.cookies}).encode()))
                temporary.replace(file)
            return {'bound':True,'account':str(expected),'video':client.h5_video_upload_available() and bool(ffmpeg_path()),'videoCredentials':client.h5_video_upload_available(),'ffmpeg':bool(ffmpeg_path())}
        target=int(p.get('target') or expected)
        if operation=='feed':
            payload=await client.legacy_feeds(target,num=min(20,int(p.get('limit',10))))
            _,entries=extract_feed_page(payload,default_hostuin=target)
            return {'posts':[{'target':str(e.hostuin),'fid':e.fid,'appid':e.appid,'text':e.summary,'nickname':e.nickname,'createdAt':e.created_at,'likes':e.like_count,'liked':e.liked,'comments':e.comment_count} for e in entries]}
        if operation=='detail':
            from qzone_bridge.social import extract_comments, clean_qzone_text, extract_images
            detail=await client.detail(target,p['fid'])
            texts=values_for(detail,{'content','con','summary'})
            text=next((clean_qzone_text(t) for t in texts if isinstance(t,str) and t.strip()),'')
            serialized=json.dumps(detail,ensure_ascii=False)
            return {'target':str(target),'fid':p['fid'],'text':text,'images':extract_images(detail,fid=p['fid'],hostuin=target),'videoIds':values_for(detail,{'vid','sVid','svid','video_id','videoId','videoid','vidid'})+list(set(re.findall(r'1075_[A-Za-z0-9_-]{15,}',serialized))),'publicMarkers':values_for(detail,{'ugc_right','who','is_public','isPublic'}),'mediaFields':[{'key':k,'type':type(v).__name__,'size':len(str(v))} for k,v in detail.items() if re.search(r'vid|video|rich|pic|media|attach',k,re.I)],'comments':[{'id':c.commentid,'uin':str(c.uin),'nickname':c.nickname,'text':c.content,'parentId':c.parent_id} for c in extract_comments(detail)][:100]}
        if operation=='visitors':return await client.get_visitors(count=20)
        if operation=='videoVerify':return await verify_video_resource(client,p['vid'])
        if operation=='publish':
            result=await client.publish_mood(p['text'],photos=p.get('images') or [])
            ids=values_for(result,{'tid','fid'})
            fid=next((str(v) for v in ids if isinstance(v,(str,int)) and str(v)),'')
            return {'serverAccepted':True,'fid':fid,'verified':False}
        if operation=='publishVideo':return await publish_video(client,p)
        if operation=='comment':return await client.add_comment(target,p['fid'],p['text'])
        if operation=='reply':return await client.reply_comment(target,p['fid'],p['commentId'],int(p['commentUin']),p['text'])
        if operation in ('like','unlike'):return await client.like_post(target,p['fid'],like=operation=='like')
        if operation=='delete':
            if target!=expected:raise RuntimeError('ONLY_OWN_POSTS')
            return await client.delete_post(p['fid'])
        raise RuntimeError('UNSUPPORTED_OPERATION')
    finally:await client.close()

if __name__=='__main__':
    try:
        raw=sys.stdin.buffer.read(256*1024)
        body=json.loads(raw)
        # Third-party import/diagnostic stdout must never corrupt the protocol or reveal cookies.
        with contextlib.redirect_stdout(sys.stderr):result=asyncio.run(run(body))
        print(response_json({'ok':True,'data':result}))
    except Exception as exc:
        known=str(exc)
        allowed={'WINDOWS_REQUIRED','CREDENTIAL_PROTECTION_FAILED','NOT_BOUND','ACCOUNT_MISMATCH','ACCOUNT_MISMATCH_OR_COOKIE_INCOMPLETE','ONLY_OWN_POSTS','UNSUPPORTED_OPERATION'}
        chain=[];cause=exc
        for _ in range(4):
            if cause is None:break
            chain.append(type(cause).__name__);cause=cause.__cause__
        detail=getattr(exc,'detail',{})
        diagnostic={'types':chain,'httpStatus':getattr(exc,'status_code',None) or (detail.get('status_code') if isinstance(detail,dict) else None),'encoding':getattr(exc,'encoding',None),'reason':getattr(exc,'reason',None),'frames':[{'file':Path(f.filename).name,'line':f.lineno,'function':f.name} for f in traceback.extract_tb(exc.__traceback__)[-10:]]}
        try:
            Path(body['credentialFile']).with_name('last-diagnostic.json').write_text(json.dumps(diagnostic),encoding='utf-8')
        except Exception:pass
        print(json.dumps({'ok':False,'error':known if known in allowed else type(exc).__name__,'diagnostic':diagnostic,'rebind':'rebind' in type(exc).__name__.lower()}))
