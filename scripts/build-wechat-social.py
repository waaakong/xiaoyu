"""Build the isolated finite-test social DLL. Never loads or starts a DLL."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
ROOT=Path(__file__).resolve().parents[1]
EXPECTED='afe3d02c58bada3c35009c0cd58ee1f57b2a00fe53237d0dce649107fddb9a20'

def main():
    p=argparse.ArgumentParser();p.add_argument('--compiler',required=True);p.add_argument('--offline-test',action='store_true');args=p.parse_args()
    sys.path.insert(0,str(ROOT/'data/wechat-analysis-libs'));spec=importlib.util.spec_from_file_location('analysis',ROOT/'scripts/wechat-native-analyze.py');a=importlib.util.module_from_spec(spec);spec.loader.exec_module(a)
    core=a.Image(r'C:\Program Files\Tencent\Weixin\4.2.0.13\Weixin.dll')
    if core.summary()['sha256']!=EXPECTED:raise ValueError('exact core hash mismatch')
    out=ROOT/'data/wechat-social-research'/('build-mock' if args.offline_test else 'build');out.mkdir(parents=True,exist_ok=True)
    constants={'XY_IMAGE_SIZE':core.pe.OPTIONAL_HEADER.SizeOfImage,'XY_ROOT_GLOBAL':0xbd0fdf0,'XY_ROOT_VTABLE':0x9057b98,'XY_MANAGER_VTABLE':0x90d3ec8,'XY_MANAGER_DISPATCH':0x35f490,'XY_APP_TASK_CTOR':0x3af93a0,'XY_PAT_TASK_CTOR':0x3a90c60,'XY_HOLDER_WRITE':0x6ac5d0,'XY_HOLDER_DATA':0x6ac610,'XY_HOLDER_SIZE':0x6ac640,'XY_APP_INFO_HEADER':0x9817d00,'XY_PAT_INFO_HEADER':0x9810500}
    # Pat task's response getter is checked from its actual current vtable.
    from capstone import Cs,CS_ARCH_X86,CS_MODE_64
    import struct
    decoder=Cs(CS_ARCH_X86,CS_MODE_64);ctor=list(decoder.disasm(core.read(constants['XY_PAT_TASK_CTOR'],317),constants['XY_PAT_TASK_CTOR']))
    tables=[]
    for ins in ctor:
        if ins.mnemonic=='lea' and ins.op_str.startswith('rax, [rip + '):
            displacement=int(ins.op_str.split('+ ')[1].split(']')[0],16);tables.append(ins.address+ins.size+displacement)
    if len(tables)!=1:raise ValueError('Pat vtable not uniquely identified')
    getter=struct.unpack_from('<Q',core.read(tables[0]+32,8))[0]-core.pe.OPTIONAL_HEADER.ImageBase
    code=core.read(getter,8)
    if code[:3]!=b'\x48\x8d\x81' or code[7]!=0xc3:raise ValueError('Pat result getter shape mismatch')
    constants['XY_PAT_RESPONSE_OFFSET']=struct.unpack_from('<I',code,3)[0]
    header=['#define '+key+' '+hex(value) for key,value in constants.items()];checks=[]
    header.append('static const struct {unsigned rva,size;unsigned char bytes[32];} checks[]={')
    for rva in [0x45d10,0x469d0,0x35f490,0x3af9060,0x3af93a0,0x3a90920,0x3a90c60,0x6ac5d0,0x6ac610,0x6ac640,0xf33f90,0xf34080,getter]:
        data=core.read(rva,32);checks.append({'rva':hex(rva),'bytes':data.hex()});header.append('{'+hex(rva)+',32,{'+','.join(hex(x) for x in data)+'}},')
    header.append('};');(out/'profile.h').write_text('\n'.join(header)+'\n')
    source=ROOT/'integrations/wechat/social-native/social-bridge.c';dll=out/('XiaoyuWechatSocialMock.dll' if args.offline_test else 'XiaoyuWechatSocial.dll')
    temporary=out/'tmp';temporary.mkdir(exist_ok=True);env=dict(os.environ,ZIG_GLOBAL_CACHE_DIR=str(out/'cache'),ZIG_LOCAL_CACHE_DIR=str(out/'local-cache'),TEMP=str(temporary),TMP=str(temporary),TMPDIR=str(temporary))
    subprocess.run([args.compiler,'cc','-shared','-O2','-fms-extensions',*(['-DXY_OFFLINE_TEST'] if args.offline_test else []),'-target','x86_64-windows-gnu','-I',str(out),str(source),'-lws2_32','-o',str(dll)],cwd=ROOT,env=env,check=True)
    manifest={'schema':1,'status':'experimental-unvalidated','nativeProtocol':3,'version':'4.2.0.13','coreSha256':EXPECTED,'dllSha256':hashlib.sha256(dll.read_bytes()).hexdigest(),'sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'identitySha256':hashlib.sha256(source.with_name('identity.h').read_bytes()).hexdigest(),'offlineTest':args.offline_test,'loaded':False,'maxSubmissions':512,'initialTestLimit':3,'pinnedUntilWechatExit':True,'constants':{k:hex(v) for k,v in constants.items()},'checks':checks,'notice':'Static candidates and mock tests do not prove real native sending. New DLL loading and finite sends require review.'}
    (out/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n');print(json.dumps({'dll':str(dll),'sha256':manifest['dllSha256'],'loaded':False,'offlineTest':args.offline_test}))

if __name__=='__main__':main()
