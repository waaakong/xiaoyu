"""Build an exact-file native text adapter; never install or load it."""
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
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--compiler',required=True)
    parser.add_argument('--offline-test',action='store_true',help='Build a mock-only DLL; never load it into WeChat')
    parser.add_argument('--voice',action='store_true',help='Build separate experimental voice-only DLL, never load it')
    parser.add_argument('--media',action='store_true',help='Build isolated experimental protocol-2 media adapter')
    parser.add_argument('--mentions',action='store_true',help='Build isolated experimental group mention adapter; never load it')
    parser.add_argument('--output-dir',help='Optional isolated directory beneath data/wechat-native-research')
    parser.add_argument('--core',default=r'C:\Program Files\Tencent\Weixin\4.2.0.13\Weixin.dll')
    args=parser.parse_args()
    if args.voice and (args.media or args.mentions):raise SystemExit('Voice is an independent module')
    if args.mentions:args.media=True
    sys.path.insert(0,str(ROOT/'data/wechat-analysis-libs'))
    spec=importlib.util.spec_from_file_location('native_analysis',ROOT/'scripts/wechat-native-analyze.py')
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    core=module.Image(args.core)
    if core.summary()['sha256']!=EXPECTED: raise SystemExit('Core fingerprint mismatch; no build')
    source=ROOT/'integrations/wechat/native'/('voice-bridge.c' if args.voice else 'mention-bridge.c' if args.mentions else 'media-bridge.c' if args.media else 'bridge.c')
    output=Path(args.output_dir).resolve() if args.output_dir else ROOT/'data/wechat-native-research/build'
    if not output.is_relative_to((ROOT/'data/wechat-native-research').resolve()):raise SystemExit('Output must stay under the native research directory')
    if (args.media or args.voice) and output==(ROOT/'data/wechat-native-research/build').resolve():raise SystemExit('Media builds must use an isolated --output-dir')
    output.mkdir(parents=True,exist_ok=True)
    header=['#define XY_IMAGE_SIZE 206430208', '#define XY_ALLOCATE 0x76a750c',
            '#define XY_FACTORY 0x71ea50','#define XY_PARAMS 0xf910',
            '#define XY_SEND 0x1a20280','#define XY_VECTOR_VTABLE 0x93f9a48',
            '#define XY_VOICE_FACTORY 0x6e55af0','#define XY_VOICE_BODY 0x9e2a218','#define XY_VOICE_OWNER 0x9e2a188',
            '#define XY_FILE_FACTORY 0x1db9d60','#define XY_FILE_OWNER 0x93c1e08','#define XY_FILE_BODY 0x93c1e98',
            '#define XY_EMOJI_FACTORY 0x1c47ac0','#define XY_EMOJI_OWNER 0x93c2088','#define XY_EMOJI_BODY 0x93c2118',
            'static const struct {unsigned rva,size;unsigned char bytes[32];} checks[]={']
    checks=[]
    for rva in (0x71ea50,0x790db0,0xf910,0x1a20280,0x76a750c,0x3e38226,0xf055,0x1db9d60,0x1ad16e0,0x1c47ac0,0x1c561a0,0x1db93bd,0x49eb2ee,0x6e55af0,0x6e56d10,0x6e55690,0x5f4ac00):
        data=core.read(rva,32)
        header.append('{0x%x,32,{%s}},'%(rva,','.join('0x%02x'%v for v in data)))
        checks.append({'rva':hex(rva),'bytes':data.hex()})
    if args.mentions:
        data=core.read(0x790e45,32)
        header.append('{0x790e45,32,{%s}},'%(','.join('0x%02x'%v for v in data)))
        checks.append({'rva':'0x790e45','bytes':data.hex()})
    header.append('};')
    (output/'profile.h').write_text('\n'.join(header)+'\n')
    dll=output/('XiaoyuWechatVoiceMock.dll' if args.voice and args.offline_test else 'XiaoyuWechatVoice.dll' if args.voice else 'XiaoyuWechatMock.dll' if args.offline_test else 'XiaoyuWechatNative.dll')
    temporary=output/'tmp';temporary.mkdir(exist_ok=True)
    env=dict(os.environ,ZIG_GLOBAL_CACHE_DIR=str(output/'cache'),ZIG_LOCAL_CACHE_DIR=str(output/'local-cache'),
             TEMP=str(temporary),TMP=str(temporary),TMPDIR=str(temporary))
    subprocess.run([args.compiler,'cc','-shared','-O2','-fms-extensions',*(['-DXY_OFFLINE_TEST'] if args.offline_test else []),'-target','x86_64-windows-gnu',
                    '-I',str(output),str(source),'-lws2_32','-lbcrypt','-o',str(dll)],check=True,cwd=ROOT,env=env)
    manifest={'schema':1,'status':'experimental-unvalidated','version':'4.2.0.13',
              'coreSha256':EXPECTED,'dllSha256':hashlib.sha256(dll.read_bytes()).hexdigest(),
              'sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'checks':checks,
              'transport':'native-voice' if args.voice else 'native-text','receive':'existing-independent-database-reader',
              'defaultSubmissionLimit':1,'defaultTarget':'filehelper','loaded':False}
    manifest['offlineTest']=args.offline_test
    manifest['voiceExperimental']=args.voice
    if args.voice:manifest['dependenciesSha256']={name:hashlib.sha256((source.parent/name).read_bytes()).hexdigest() for name in ('mention-bridge.c','voice-transport.h')}
    manifest['nativeProtocol']=2 if args.media else 1
    manifest['sourceName']=source.name
    manifest['mentionsExperimental']=args.mentions
    (output/('mock-manifest.json' if args.offline_test else 'manifest.json')).write_text(json.dumps(manifest,indent=2)+'\n')
    print(json.dumps({'dll':str(dll),'sha256':manifest['dllSha256'],'loaded':False}))


if __name__=='__main__':main()
