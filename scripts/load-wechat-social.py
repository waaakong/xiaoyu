"""Explicit exact-file social DLL load. Finite targets, no send on load.

Requires a reviewed SHA-256 argument. Does not replace, stop or unload C8.
The social module is pinned until WeChat exits to protect async callbacks.
"""
import argparse
import ctypes as c
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
ROOT=Path(__file__).resolve().parents[1]
BUILD=ROOT/'data/wechat-social-research/build'

def read(file):return json.loads(Path(file).read_text(encoding='utf-8-sig'))
def request(port,token):
    req=urllib.request.Request('http://127.0.0.1:'+str(port)+'/health',headers={'Authorization':'Bearer '+token})
    with urllib.request.urlopen(req,timeout=2) as r:return json.load(r)

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--confirm-sha256',required=True);parser.add_argument('--pat-group',required=True);parser.add_argument('--pat-member',required=True);parser.add_argument('--port',type=int,default=11346);parser.add_argument('--resume-unstarted',action='store_true');args=parser.parse_args()
    if not re.fullmatch(r'[a-f0-9]{64}',args.confirm_sha256) or not re.fullmatch(r'[0-9]+@chatroom',args.pat_group) or not re.fullmatch(r'[-A-Za-z0-9_]{1,128}',args.pat_member) or not 1024<=args.port<=65535:raise ValueError('invalid reviewed scope or hash')
    manifest=read(BUILD/'manifest.json');dll=BUILD/'XiaoyuWechatSocial.dll'
    if manifest.get('offlineTest') is not False or manifest['dllSha256']!=args.confirm_sha256 or hashlib.sha256(dll.read_bytes()).hexdigest()!=args.confirm_sha256:raise ValueError('reviewed production DLL hash mismatch')
    source=ROOT/'integrations/wechat/social-native/social-bridge.c'
    if hashlib.sha256(source.read_bytes()).hexdigest()!=manifest['sourceSha256'] or hashlib.sha256(source.with_name('identity.h').read_bytes()).hexdigest()!=manifest['identitySha256']:raise ValueError('source changed since build')
    spec=importlib.util.spec_from_file_location('owned_loader',ROOT/'scripts/load-wechat-native.py');loader=importlib.util.module_from_spec(spec);spec.loader.exec_module(loader)
    old=read(ROOT/'data/wechat-native-research/session.json');manager=read(ROOT/'data/wechat-connection.json');health=request(old['port'],old['token'])
    if health.get('pid')!=old['pid'] or health.get('verified') is not True or health.get('mediaMask')!=19 or health.get('version')!='4.2.0.13' or manager['account'] not in health.get('accountDirectory',''):raise ValueError('validated C8/account not ready')
    rows=loader.modules(old['pid']);cores=[m for m in rows if Path(m['path']).name.lower()=='weixin.dll'];executables=[m for m in rows if Path(m['path']).name.lower()=='weixin.exe']
    if len(cores)!=1 or len(executables)!=1 or loader.fingerprint(cores[0]['path'])!=manifest['coreSha256'] or loader.fingerprint(executables[0]['path'])!=loader.EXE_SHA:raise ValueError('client exact-file identity mismatch')
    present=[m for m in rows if Path(m['path']).name.lower()=='xiaoyuwechatsocial.dll'];previous_file=ROOT/'data/wechat-social-research/session.json'
    if present:
        previous=read(previous_file)
        if not args.resume_unstarted or len(present)!=1 or Path(present[0]['path'])!=dll or previous.get('startAttempted') is not False or previous.get('dllSha256')!=args.confirm_sha256 or previous.get('pid')!=old['pid']:raise ValueError('social DLL already present or start uncertain; no duplicate load')
    exports=loader.export_rvas(dll,required={'XiaoyuSocialStart','XiaoyuSocialStop','XiaoyuSocialValidate'})
    with socket.socket() as check:check.bind(('127.0.0.1',args.port))
    token=secrets.token_hex(32);account=health['accountDirectory'];wxid=manager['account']
    def field(value,size):
        b=value.encode('utf8')
        if len(b)>=size:raise ValueError('field too long')
        return b+b'\0'*(size-len(b))
    config=struct.pack('<5I65s129s129s129s129s3x',0x32535958,604,old['pid'],args.port,3,field(token,65),field(account,129),field(wxid,129),field(args.pat_group,129),field(args.pat_member,129))
    process=loader.k.OpenProcess(0x43a,False,old['pid'])
    if not process:raise OSError('explicit native load access unavailable')
    target=ROOT/'data/wechat-social-research/session.json';state={'pid':old['pid'],'port':args.port,'token':token,'accountDirectory':account,'dllSha256':args.confirm_sha256,'dllPath':str(dll),'initialLimit':3,'patGroup':args.pat_group,'patMember':args.pat_member,'loaded':bool(present),'startAttempted':False,'healthVerified':False,'pinnedUntilWechatExit':True,'c8Replaced':False}
    try:
        if not present:
            path=loader.allocate(process,(str(dll)+'\0').encode('utf-16le'));loader.call(process,loader.remote_export(old['pid'],'LoadLibraryW'),path);loader.k.VirtualFreeEx(process,path,0,0x8000)
        found=[m for m in loader.modules(old['pid']) if Path(m['path'])==dll]
        if len(found)!=1:raise OSError('new module load not confirmed')
        state['loaded']=True;argument=loader.allocate(process,config);state['startAttempted']=True;target.write_text(json.dumps(state,indent=2),encoding='utf8');target.chmod(0o600)
        result=loader.call(process,found[0]['base']+exports['XiaoyuSocialStart'],argument);loader.k.VirtualFreeEx(process,argument,0,0x8000)
        if result:raise OSError('social start refused: '+str(result))
        for _ in range(10):
            try:
                status=request(args.port,token)
                if status.get('pid')==old['pid'] and status.get('accountDirectory')==account and status.get('verified') is True and status.get('limit')==3:state['healthVerified']=True;break
            except (OSError,ValueError):pass
            time.sleep(.2)
        if not state['healthVerified']:raise OSError('social health not confirmed; do not repeat load')
    finally:
        loader.k.CloseHandle(process);target.write_text(json.dumps(state,indent=2),encoding='utf8');target.chmod(0o600)
    print(json.dumps({'loaded':True,'healthVerified':True,'pid':old['pid'],'port':args.port,'dllSha256':args.confirm_sha256,'initialLimit':3,'c8Replaced':False,'pinnedUntilWechatExit':True}))

if __name__=='__main__':main()
