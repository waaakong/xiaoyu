"""Explicit reviewed voice DLL load. No sends, no replacement of C8."""
import argparse
import ctypes as c
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import secrets
import socket
import urllib.request
ROOT=Path(__file__).resolve().parents[1]
BASE=ROOT/'data/wechat-native-research'
BUILD=BASE/'build-voice'


def read(file):return json.loads(Path(file).read_text(encoding='utf-8-sig'))


def health(port,token):
    req=urllib.request.Request('http://127.0.0.1:'+str(port)+'/health',headers={'Authorization':'Bearer '+token})
    with urllib.request.urlopen(req,timeout=3) as r:return json.load(r)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--confirm-sha256',required=True)
    parser.add_argument('--port',type=int,default=11348)
    parser.add_argument('--enable-validated',action='store_true',help='Rearm already loaded component only after matching live acceptance')
    args=parser.parse_args()
    if not re.fullmatch('[a-f0-9]{64}',args.confirm_sha256) or not 1024<=args.port<=65535:raise ValueError('Invalid reviewed hash/port')
    manifest=read(BUILD/'manifest.json');dll=BUILD/'XiaoyuWechatVoice.dll'
    if manifest.get('offlineTest') is not False or manifest.get('voiceExperimental') is not True or manifest['dllSha256']!=args.confirm_sha256 or hashlib.sha256(dll.read_bytes()).hexdigest()!=args.confirm_sha256:raise ValueError('Reviewed DLL mismatch')
    source=ROOT/'integrations/wechat/native/voice-bridge.c'
    if hashlib.sha256(source.read_bytes()).hexdigest()!=manifest['sourceSha256']:raise ValueError('Source changed since build')
    for name,sha in manifest['dependenciesSha256'].items():
        if hashlib.sha256(source.with_name(name).read_bytes()).hexdigest()!=sha:raise ValueError('Dependency changed since build')
    spec=importlib.util.spec_from_file_location('owned_loader',ROOT/'scripts/load-wechat-native.py');loader=importlib.util.module_from_spec(spec);spec.loader.exec_module(loader)
    old=read(BASE/'session.json');manager=read(ROOT/'data/wechat-connection.json');status=health(old['port'],old['token'])
    if status.get('pid')!=old['pid'] or status.get('verified') is not True or status.get('mediaMask')!=19 or status.get('version')!='4.2.0.13' or manager['account'] not in status.get('accountDirectory',''):raise ValueError('Validated C8/account not ready')
    rows=loader.modules(old['pid']);cores=[m for m in rows if Path(m['path']).name.lower()=='weixin.dll'];exes=[m for m in rows if Path(m['path']).name.lower()=='weixin.exe']
    if len(cores)!=1 or len(exes)!=1 or loader.fingerprint(cores[0]['path'])!=manifest['coreSha256'] or loader.fingerprint(exes[0]['path'])!=loader.EXE_SHA:raise ValueError('Exact client fingerprint mismatch')
    present=[m for m in rows if Path(m['path']).name.lower()=='xiaoyuwechatvoice.dll'];target=BASE/'voice-session.json'
    if present and not args.enable_validated:raise ValueError('Module already loaded; no duplicate load or trial')
    limit=1
    if args.enable_validated:
        v=read(BASE/'voice-validation.json');previous=read(target)
        if len(present)!=1 or Path(present[0]['path'])!=dll or v.get('confirmed') is not True or v.get('voiceBubbleVerified') is not True or v.get('dllSha256')!=args.confirm_sha256 or previous.get('pid')!=old['pid'] or previous.get('dllSha256')!=args.confirm_sha256:raise ValueError('Live voice acceptance missing')
        health(previous['port'],previous['token']);limit=100000
    else:
        with socket.socket() as check:check.bind(('127.0.0.1',args.port))
    exports=loader.export_rvas(dll,required={'XiaoyuVoiceStart','XiaoyuVoiceStop','XiaoyuVoiceValidate'})
    root=BASE/'voice-outgoing';root.mkdir(exist_ok=True)
    token=secrets.token_hex(32);account=status['accountDirectory']
    config=loader.start_config(old['pid'],args.port,limit,token,account,1,root);config.magic=0x31565958
    process=loader.k.OpenProcess(0x43a,False,old['pid'])
    if not process:raise OSError('Explicit native load access unavailable')
    state={'pid':old['pid'],'port':args.port,'token':token,'accountDirectory':account,'dllSha256':args.confirm_sha256,'dllPath':str(dll),'initialLimit':limit,'loaded':False,'startAttempted':False,'healthVerified':False,'c8Replaced':False}
    try:
        if args.enable_validated:
            if loader.call(process,present[0]['base']+exports['XiaoyuVoiceStop']):raise OSError('Voice stop unconfirmed; do not rearm')
        else:
            address=loader.allocate(process,(str(dll)+'\0').encode('utf-16le'));loader.call(process,loader.remote_export(old['pid'],'LoadLibraryW'),address);loader.k.VirtualFreeEx(process,address,0,0x8000)
        found=[m for m in loader.modules(old['pid']) if Path(m['path'])==dll]
        if len(found)!=1:raise OSError('Module load unconfirmed')
        state['loaded']=True;argument=loader.allocate(process,bytes(config));state['startAttempted']=True;target.write_text(json.dumps(state,indent=2),encoding='utf8');target.chmod(0o600)
        result=loader.call(process,found[0]['base']+exports['XiaoyuVoiceStart'],argument);loader.k.VirtualFreeEx(process,argument,0,0x8000)
        if result:raise OSError('Voice start refused: '+str(result))
        h=health(args.port,token)
        if h.get('integration')!='XiaoyuVoice-1' or h.get('offlineTest') is not False or h.get('pid')!=old['pid'] or h.get('accountDirectory')!=account or h.get('verified') is not True or h.get('limit')!=limit:raise OSError('Voice health unconfirmed')
        state['healthVerified']=True
    finally:
        loader.k.CloseHandle(process);target.write_text(json.dumps(state,indent=2),encoding='utf8');target.chmod(0o600)
    print(json.dumps({key:state[key] for key in ('loaded','healthVerified','pid','port','dllSha256','initialLimit','c8Replaced')}))


if __name__=='__main__':main()
