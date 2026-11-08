"""Offline-only exact-file Moments DLL build. Never opens a WeChat process."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import struct
import subprocess
import sys
ROOT=Path(__file__).resolve().parents[1]
EXPECTED='afe3d02c58bada3c35009c0cd58ee1f57b2a00fe53237d0dce649107fddb9a20'

def main():
    p=argparse.ArgumentParser();p.add_argument('--compiler',required=True);p.add_argument('--offline-test',action='store_true');args=p.parse_args()
    sys.path.insert(0,str(ROOT/'data/wechat-analysis-libs'));spec=importlib.util.spec_from_file_location('analysis',ROOT/'scripts/wechat-native-analyze.py');a=importlib.util.module_from_spec(spec);spec.loader.exec_module(a)
    core=a.Image('C:/Program Files/Tencent/Weixin/4.2.0.13/Weixin.dll')
    if core.summary()['sha256']!=EXPECTED:raise ValueError('core hash mismatch; no offsets reused on another version')
    constants={'XY_IMAGE_SIZE':core.pe.OPTIONAL_HEADER.SizeOfImage,'XY_ROOT_GLOBAL':0xbd0fdf0,'XY_ROOT_VTABLE':0x9057b98,'XY_MANAGER_VTABLE':0x90d3ec8,'XY_MANAGER_DISPATCH':0x35f490,'XY_POST_INFO':0x9b5f390,'XY_POST_CTOR':0x58c71a0,'XY_POST_VTABLE':0x9b5f858,'XY_DETAIL_INFO':0x96fc9f0,'XY_DETAIL_CTOR':0x3163730,'XY_DETAIL_VTABLE':0x97009b8,'XY_ALLOCATE':0x76a750c,'XY_PROTO_PARSE':0x6abe50,'XY_HOLDER_DATA':0x6ac610,'XY_HOLDER_SIZE':0x6ac640}
    base=core.pe.OPTIONAL_HEADER.ImageBase
    vt=struct.unpack('<6Q',core.read(constants['XY_POST_VTABLE'],48))
    if [v-base for v in vt[:5]]!=[0x58c74a0,0x58c7370,0x58c7460,0x115010,0x1eb5900] or vt[5]!=1:raise ValueError('SNS vtable mismatch')
    if core.read(0x115010,8)!=bytes.fromhex('488d81a8000000c3') or core.read(0x1eb5900,8)!=bytes.fromhex('488d8148020000c3'):raise ValueError('SNS request/result offsets mismatch')
    out=ROOT/'data/wechat-moments-research'/('build-mock' if args.offline_test else 'build');out.mkdir(parents=True,exist_ok=True)
    header=['#define '+k+' '+hex(v) for k,v in constants.items()];header.append('static const struct {unsigned rva,size;unsigned char bytes[32];} checks[]={');checks=[]
    # Never compare file absolute pointers with ASLR-relocated pointers.
    points=[constants[k] for k in ['XY_MANAGER_DISPATCH','XY_POST_CTOR','XY_ALLOCATE','XY_PROTO_PARSE','XY_HOLDER_DATA','XY_HOLDER_SIZE']]+[0x58c7370,0x58c74f0,0x58c7460,0x58c74a0,0x115010,0x1eb5900,0x3163730,0x7b3d80,0x7b3e70,0x7b3eb0,0x3163900,0x361c03]
    for rva in points:
        data=core.read(rva,32);checks.append({'rva':hex(rva),'bytes':data.hex()});header.append('{'+hex(rva)+',32,{'+','.join(hex(x) for x in data)+'}},')
    header.append('};');(out/'profile.h').write_text('\n'.join(header)+'\n')
    source=ROOT/'integrations/wechat/moments-native/moments-bridge.c';identity=ROOT/'integrations/wechat/social-native/identity.h';dll=out/('XiaoyuWechatMomentsMock.dll' if args.offline_test else 'XiaoyuWechatMoments.dll')
    temp=out/'tmp';temp.mkdir(exist_ok=True);env=dict(os.environ,ZIG_GLOBAL_CACHE_DIR=str(out/'cache'),ZIG_LOCAL_CACHE_DIR=str(out/'local-cache'),TEMP=str(temp),TMP=str(temp),TMPDIR=str(temp))
    subprocess.run([args.compiler,'cc','-shared','-O2','-Wall','-Wextra','-fms-extensions',*(['-DXY_OFFLINE_TEST'] if args.offline_test else []),'-target','x86_64-windows-gnu','-I',str(out),str(source),'-lws2_32','-lbcrypt','-o',str(dll)],cwd=ROOT,env=env,check=True)
    manifest={'schema':1,'version':'4.2.0.13','status':'experimental-unvalidated','coreSha256':EXPECTED,'dllSha256':hashlib.sha256(dll.read_bytes()).hexdigest(),'sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'identitySha256':hashlib.sha256(identity.read_bytes()).hexdigest(),'offlineTest':args.offline_test,'loaded':False,'limit':1,'contentHashBound':True,'nativeSerializerPreserved':True,'completionCallback':True,'objectDetailCandidate':True,'pinnedUntilWechatExit':True,'capabilities':{'textValidated':False,'images':False,'video':False},'constants':{k:hex(v) for k,v in constants.items()},'checks':checks}
    (out/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n');print(json.dumps({'dll':str(dll),'sha256':manifest['dllSha256'],'loaded':False,'offlineTest':args.offline_test}))
if __name__=='__main__':main()
