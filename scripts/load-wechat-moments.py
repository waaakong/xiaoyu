"""Load ONLY a reviewed Moments DLL, bound to ONE reviewed exact packet.
No publish on loading. No replacement of C8/social DLL. Pinned until WeChat exit.
"""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import secrets
import socket
import struct
import time
import urllib.request
import xml.etree.ElementTree as ET
ROOT=Path(__file__).resolve().parents[1]
BASE=ROOT/'data/wechat-moments-research'
def read(file):return json.loads(Path(file).read_text(encoding='utf-8-sig'))
def digest(file):return hashlib.sha256(Path(file).read_bytes()).hexdigest()
def proto(data):
    at=0;result={}
    def var():
        nonlocal at
        value=0
        for k in range(10):
            if at>=len(data):raise ValueError('truncated protobuf')
            c=data[at];at+=1
            if k==9 and c>1:raise ValueError('protobuf integer overflow')
            value|=(c&127)<<(7*k)
            if not c&128:return value
        raise ValueError('protobuf varint invalid')
    while at<len(data):
        tag=var();key=tag>>3;wire=tag&7
        if not key or key in result:raise ValueError('duplicate or invalid field')
        if wire==0:value=var()
        elif wire==2:
            size=var()
            if size>len(data)-at:raise ValueError('protobuf field overflow')
            value=data[at:at+size];at+=size
        else:raise ValueError('unsupported proposal wire')
        result[key]=value
    return result
def verify_proposal(proposal,packet):
    if len(packet)<44 or len(packet)>32044:raise ValueError('proposal packet bounds')
    magic,request_id,size=struct.unpack('<I36sI',packet[:44])
    if magic not in [0x314d5958,0x334d5958] or size!=len(packet)-44 or request_id.decode('ascii')!=proposal['requestId']:raise ValueError('proposal packet identity')
    fields=proto(packet[44:])
    if proposal.get('kind')=='detail':
        if magic!=0x334d5958 or set(fields)!={1,2,3} or fields[2]!=int(proposal['objectId']) or fields[3]!=0:raise ValueError('read-only object mismatch')
        return
    if magic!=0x314d5958:raise ValueError('publish packet kind mismatch')
    if set(fields)!={1,2,3,5,6,7,8,9,11,13,16} or any(fields[k]!=0 for k in [3,5,6,8,9,11,13,16]) or fields[7]!=request_id:raise ValueError('unreviewed audience or fields')
    buffer=proto(fields[2])
    if set(buffer)!={1,2} or buffer[1]!=len(buffer[2]) or b'<!' in buffer[2]:raise ValueError('invalid timeline buffer')
    root=ET.fromstring(buffer[2].decode('utf8'))
    if root.tag!='TimelineObject' or root.findtext('username')!=proposal['account'] or root.findtext('contentDesc')!=proposal['text'] or root.findtext('private')!='0' or root.findtext('ContentObject/contentStyle')!='2' or len(root.findall('ContentObject/mediaList/*')) or proposal['visibility']!='public' or root.findtext('createTime')!=str(proposal['created']//1000):raise ValueError('displayed content differs from native payload')
def health(port,token):
    request=urllib.request.Request(f'http://127.0.0.1:{port}/health',headers={'Authorization':'Bearer '+token})
    with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(request,timeout=3) as response:return json.load(response)
def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--confirm-sha256',required=True);p.add_argument('--proposal',required=True);p.add_argument('--confirm-content-sha256',required=True);p.add_argument('--port',type=int,default=11347);args=p.parse_args()
    if not all(re.fullmatch('[a-f0-9]{64}',s) for s in [args.confirm_sha256,args.confirm_content_sha256]) or not 1024<=args.port<=65535:raise ValueError('reviewed hash/port invalid')
    m=read(BASE/'build/manifest.json');dll=BASE/'build/XiaoyuWechatMoments.dll';source=ROOT/'integrations/wechat/moments-native/moments-bridge.c'
    if m.get('offlineTest') is not False or m['dllSha256']!=args.confirm_sha256 or digest(dll)!=args.confirm_sha256 or digest(source)!=m['sourceSha256'] or digest(ROOT/'integrations/wechat/social-native/identity.h')!=m['identitySha256']:raise ValueError('reviewed build/source identity mismatch')
    proposal_file=Path(args.proposal).resolve();proposal=read(proposal_file);packet_file=Path(proposal['packetFile']).resolve()
    if proposal_file.parent!=(BASE/'proposals').resolve() or packet_file!=proposal_file.with_suffix('.bin') or proposal.get('kind') not in ['text','detail'] or proposal.get('kind')=='text' and proposal.get('visibility')!='public' or digest(packet_file)!=args.confirm_content_sha256 or proposal['packetSha256']!=args.confirm_content_sha256 or proposal['coreSha256']!=m['coreSha256']:raise ValueError('finite reviewed content mismatch')
    verify_proposal(proposal,packet_file.read_bytes())
    spec=importlib.util.spec_from_file_location('loader',ROOT/'scripts/load-wechat-native.py');loader=importlib.util.module_from_spec(spec);spec.loader.exec_module(loader)
    c8=read(ROOT/'data/wechat-native-research/session.json');connection=read(ROOT/'data/wechat-connection.json');h=health(c8['port'],c8['token']);account=h.get('accountDirectory','');wxid=connection.get('account','')
    if h.get('verified') is not True or h.get('version')!='4.2.0.13' or h.get('mediaMask')!=19 or h.get('pid')!=c8['pid'] or proposal['account']!=wxid or not re.fullmatch('wxid_[A-Za-z0-9_]{1,100}',wxid) or not account.startswith(wxid+'_'):raise ValueError('validated C8/current account mismatch')
    rows=loader.modules(c8['pid']);core=[x for x in rows if Path(x['path']).name.lower()=='weixin.dll'];exe=[x for x in rows if Path(x['path']).name.lower()=='weixin.exe']
    if len(core)!=1 or len(exe)!=1 or loader.fingerprint(core[0]['path'])!=m['coreSha256'] or loader.fingerprint(exe[0]['path'])!=loader.EXE_SHA:raise ValueError('exact WeChat identity mismatch')
    if any(Path(x['path']).name.lower()=='xiaoyuwechatmoments.dll' for x in rows):raise ValueError('Moments module already loaded; do not load twice')
    previous=BASE/'session.json'
    if previous.exists() and read(previous).get('pid')==c8['pid']:raise ValueError('previous load attempt exists in this process; inspect before retry')
    exports=loader.export_rvas(dll,required={'XiaoyuMomentsStart','XiaoyuMomentsStop','XiaoyuMomentsValidate','XiaoyuMomentsParse'})
    with socket.socket() as probe:probe.bind(('127.0.0.1',args.port))
    token=secrets.token_hex(32)
    def field(value,n):
        data=value.encode('utf8')
        if len(data)>=n:raise ValueError('field overflow')
        return data+b'\0'*(n-len(data))
    config=struct.pack('<4I65s129s129s65s',0x324d5958,404,c8['pid'],args.port,field(token,65),field(account,129),field(wxid,129),field(args.confirm_content_sha256,65))
    process=loader.k.OpenProcess(0x43a,False,c8['pid'])
    if not process:raise OSError('explicit load access unavailable')
    state={'pid':c8['pid'],'port':args.port,'token':token,'wxid':wxid,'accountDirectory':account,'dllSha256':args.confirm_sha256,'dllPath':str(dll),'approvedHash':args.confirm_content_sha256,'proposalId':proposal['id'],'operation':proposal['kind'],'loaded':False,'startAttempted':False,'healthVerified':False,'limit':1,'pinnedUntilWechatExit':True,'c8Replaced':False}
    try:
        # Write before LoadLibrary: an uncertain result must not trigger a second injection.
        previous.write_text(json.dumps(state,indent=2),encoding='utf8');previous.chmod(0o600)
        remote_path=loader.allocate(process,(str(dll)+'\0').encode('utf-16le'));loader.call(process,loader.remote_export(c8['pid'],'LoadLibraryW'),remote_path);loader.k.VirtualFreeEx(process,remote_path,0,0x8000)
        found=[x for x in loader.modules(c8['pid']) if Path(x['path']).resolve()==dll.resolve()]
        if len(found)!=1:raise OSError('module loading not confirmed; do not retry')
        state['loaded']=True;argument=loader.allocate(process,config);state['startAttempted']=True;previous.write_text(json.dumps(state,indent=2),encoding='utf8')
        ret=loader.call(process,found[0]['base']+exports['XiaoyuMomentsStart'],argument);loader.k.VirtualFreeEx(process,argument,0,0x8000)
        if ret:raise OSError('Moments startup refused: '+str(ret))
        for _ in range(10):
            try:
                h=health(args.port,token)
                if h.get('pid')==c8['pid'] and h.get('accountDirectory')==account and h.get('verified') is True and h.get('offlineTest') is False and h.get('limit')==1:state['healthVerified']=True;break
            except (OSError,ValueError):pass
            time.sleep(.2)
        if not state['healthVerified']:raise OSError('health not confirmed; no publish or repeat load')
    finally:
        loader.k.CloseHandle(process);previous.write_text(json.dumps(state,indent=2),encoding='utf8');previous.chmod(0o600)
    print(json.dumps({k:state[k] for k in ['loaded','healthVerified','pid','port','dllSha256','approvedHash','limit','c8Replaced','pinnedUntilWechatExit']}))
if __name__=='__main__':main()
