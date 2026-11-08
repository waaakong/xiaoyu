"""Explicit exact-build DLL load/stop. No client files, permissions or startup settings changed."""
import argparse
import ctypes as c
from ctypes import wintypes as w
import hashlib
import json
import os
from pathlib import Path
import secrets
import subprocess
import struct
import sys
import urllib.request

ROOT=Path(__file__).resolve().parents[1]
BUILD=ROOT/'data/wechat-native-research/build'
if not (BUILD/'manifest.json').exists():BUILD=ROOT/'integrations/wechat/native/bundle'
STATE=ROOT/'data/wechat-native-research/session.json'
EXE=Path(r'C:\Program Files\Tencent\Weixin\Weixin.exe')
EXE_SHA='eaaa1c6c6123ce9887e5c67b60d905d22f09fac091058f27d2d819e9ff26fc69'
k=c.WinDLL('kernel32',use_last_error=True)
k.OpenProcess.argtypes=[w.DWORD,w.BOOL,w.DWORD];k.OpenProcess.restype=w.HANDLE
k.CloseHandle.argtypes=[w.HANDLE]
k.CreateToolhelp32Snapshot.argtypes=[w.DWORD,w.DWORD];k.CreateToolhelp32Snapshot.restype=w.HANDLE
k.VirtualAllocEx.argtypes=[w.HANDLE,c.c_void_p,c.c_size_t,w.DWORD,w.DWORD];k.VirtualAllocEx.restype=c.c_void_p
k.VirtualFreeEx.argtypes=[w.HANDLE,c.c_void_p,c.c_size_t,w.DWORD]
k.WriteProcessMemory.argtypes=[w.HANDLE,c.c_void_p,c.c_void_p,c.c_size_t,c.POINTER(c.c_size_t)]
k.CreateRemoteThread.argtypes=[w.HANDLE,c.c_void_p,c.c_size_t,c.c_void_p,c.c_void_p,w.DWORD,c.c_void_p];k.CreateRemoteThread.restype=w.HANDLE
k.WaitForSingleObject.argtypes=[w.HANDLE,w.DWORD];k.WaitForSingleObject.restype=w.DWORD
k.GetExitCodeThread.argtypes=[w.HANDLE,c.POINTER(w.DWORD)]
k.QueryFullProcessImageNameW.argtypes=[w.HANDLE,w.DWORD,w.LPWSTR,c.POINTER(w.DWORD)]
k.GetModuleHandleW.argtypes=[w.LPCWSTR];k.GetModuleHandleW.restype=w.HMODULE
k.GetProcAddress.argtypes=[w.HMODULE,c.c_char_p];k.GetProcAddress.restype=c.c_void_p
k.GetModuleHandleExW.argtypes=[w.DWORD,c.c_void_p,c.POINTER(w.HMODULE)]
k.GetModuleFileNameW.argtypes=[w.HMODULE,w.LPWSTR,w.DWORD]


class Module(c.Structure):
    _fields_=[('size',w.DWORD),('id',w.DWORD),('pid',w.DWORD),('globalRefs',w.DWORD),('refs',w.DWORD),
              ('base',c.c_void_p),('bytes',w.DWORD),('module',w.HMODULE),('name',w.WCHAR*256),('path',w.WCHAR*260)]


class Config(c.Structure):
    _fields_=[('magic',c.c_uint32),('bytes',c.c_uint32),('pid',c.c_uint32),('port',c.c_uint32),('limit',c.c_uint32),('media_mask',c.c_uint32),
              ('token',c.c_char*65),('account',c.c_char*129),('media_root',c.c_wchar*512)]


class TextConfig(c.Structure):
    _fields_=[('magic',c.c_uint32),('pid',c.c_uint32),('port',c.c_uint32),('limit',c.c_uint32),('token',c.c_char*65),('account',c.c_char*129)]


def start_config(pid,port,limit,token,account,media_mask=0,media_root=''):
    return Config(0x324d5958,c.sizeof(Config),pid,port,limit,media_mask,token.encode(),account.encode('ascii'),str(media_root))


def modules(pid):
    snapshot=k.CreateToolhelp32Snapshot(0x18,pid)
    if snapshot==c.c_void_p(-1).value:raise OSError('MODULE_SNAPSHOT_DENIED')
    rows=[]
    try:
        item=Module();item.size=c.sizeof(item)
        k.Module32FirstW.argtypes=[w.HANDLE,c.POINTER(Module)];k.Module32NextW.argtypes=k.Module32FirstW.argtypes
        ok=k.Module32FirstW(snapshot,c.byref(item))
        while ok:
            rows.append({'name':item.name,'path':item.path,'base':item.base,'bytes':item.bytes})
            ok=k.Module32NextW(snapshot,c.byref(item))
        if not rows:raise OSError('MODULE_SNAPSHOT_EMPTY')
        return rows
    finally:k.CloseHandle(snapshot)


def remote_export(pid,name):
    local=k.GetProcAddress(k.GetModuleHandleW('kernel32.dll'),name.encode())
    owner=w.HMODULE()
    if not local or not k.GetModuleHandleExW(6,local,c.byref(owner)):raise OSError('SYSTEM_EXPORT_UNAVAILABLE')
    filename=c.create_unicode_buffer(32768);k.GetModuleFileNameW(owner,filename,len(filename))
    match=[row for row in modules(pid) if Path(row['path']).name.lower()==Path(filename.value).name.lower()]
    if len(match)!=1:raise OSError('SYSTEM_MODULE_AMBIGUOUS')
    return match[0]['base']+local-owner.value


def call(process,address,argument=0,timeout=15000):
    thread=k.CreateRemoteThread(process,None,0,address,argument,0,None)
    if not thread:raise OSError('REMOTE_THREAD_DENIED')
    try:
        if k.WaitForSingleObject(thread,timeout)!=0:
            raise OSError('REMOTE_RESULT_UNKNOWN_DO_NOT_RETRY_OR_FREE_ARGUMENT')
        result=w.DWORD()
        if not k.GetExitCodeThread(thread,c.byref(result)):raise OSError('REMOTE_RESULT_UNAVAILABLE')
        return result.value
    finally:k.CloseHandle(thread)


def allocate(process,data):
    address=k.VirtualAllocEx(process,None,len(data),0x3000,4)
    if not address:raise OSError('REMOTE_ALLOCATION_FAILED')
    written=c.c_size_t()
    if not k.WriteProcessMemory(process,address,data,len(data),c.byref(written)) or written.value!=len(data):
        k.VirtualFreeEx(process,address,0,0x8000);raise OSError('REMOTE_WRITE_FAILED')
    return address


def fingerprint(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def export_rvas(path,required=None):
    """Small bounded PE32+ export reader; runtime loading needs no pefile package."""
    data=Path(path).read_bytes()
    if len(data)<256 or data[:2]!=b'MZ':raise OSError('DLL_INVALID_PE')
    nt=struct.unpack_from('<I',data,60)[0]
    if nt+264>len(data) or data[nt:nt+4]!=b'PE\0\0':raise OSError('DLL_INVALID_PE')
    machine,sections=struct.unpack_from('<HH',data,nt+4)
    optional=nt+24;optional_size=struct.unpack_from('<H',data,nt+20)[0]
    if machine!=0x8664 or struct.unpack_from('<H',data,optional)[0]!=0x20b or sections>96:
        raise OSError('DLL_WRONG_ARCHITECTURE')
    def offset(rva,size):
        for i in range(sections):
            section=optional+optional_size+i*40
            virtual_size,start,raw_size,raw=struct.unpack_from('<4I',data,section+8)
            if start<=rva and rva+size<=start+raw_size and raw+rva-start+size<=len(data):return raw+rva-start
        raise OSError('DLL_UNMAPPED_RVA')
    directory,directory_size=struct.unpack_from('<II',data,optional+112)
    table=offset(directory,40)
    count_functions,count_names,functions,names,ordinals=struct.unpack_from('<5I',data,table+20)
    if count_names>10000 or count_functions>10000:raise OSError('DLL_EXPORT_LIMIT')
    functions=offset(functions,count_functions*4);names=offset(names,count_names*4);ordinals=offset(ordinals,count_names*2)
    result={}
    for i in range(count_names):
        name_rva=struct.unpack_from('<I',data,names+i*4)[0];start=offset(name_rva,1)
        end=data.find(b'\0',start,min(start+256,len(data)))
        if end<0:raise OSError('DLL_EXPORT_NAME_INVALID')
        name=data[start:end].decode('ascii')
        ordinal=struct.unpack_from('<H',data,ordinals+i*2)[0]
        if ordinal>=count_functions:raise OSError('DLL_EXPORT_ORDINAL_INVALID')
        rva=struct.unpack_from('<I',data,functions+ordinal*4)[0]
        if directory<=rva<directory+directory_size:raise OSError('DLL_FORWARDED_EXPORT_UNSUPPORTED')
        offset(rva,1);result[name]=rva
    if not (required if required is not None else {'XiaoyuStart','XiaoyuStop','XiaoyuValidate'})<=result.keys():raise OSError('DLL_EXPORTS_INCOMPLETE')
    if 'XiaoyuTestVerified' in result:raise OSError('MOCK_DLL_CANNOT_LOAD_IN_WECHAT')
    return result


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--pid',type=int)
    parser.add_argument('--account-directory')
    parser.add_argument('--port',type=int,default=11343)
    parser.add_argument('--limit',type=int,default=1)
    parser.add_argument('--stop',action='store_true')
    parser.add_argument('--build-dir')
    parser.add_argument('--media-mask',type=int,default=0)
    parser.add_argument('--media-root')
    args=parser.parse_args()
    state=json.loads(STATE.read_text()) if args.stop else None
    build=BUILD
    if args.build_dir:build=Path(args.build_dir).resolve()
    elif args.stop and state.get('dllPath'):build=Path(state['dllPath']).resolve().parent
    if not(build.is_relative_to((ROOT/'data/wechat-native-research').resolve()) or build==(ROOT/'integrations/wechat/native/bundle').resolve()):
        raise OSError('NATIVE_BUILD_DIRECTORY_INVALID')
    pid=state['pid'] if state else args.pid
    if not pid:parser.error('Explicit --pid is required')
    manifest=json.loads((build/'manifest.json').read_text())
    dll=(build/'XiaoyuWechatNative.dll').resolve()
    if fingerprint(dll)!=manifest['dllSha256']:raise OSError('DLL_HASH_MISMATCH')
    protocol=manifest.get('nativeProtocol',1)
    if not args.stop and (protocol not in (1,2) or protocol==1 and args.media_mask):raise OSError('NATIVE_PROTOCOL_MISMATCH')
    source_name=manifest.get('sourceName','bridge.c')
    if source_name not in ('bridge.c','media-bridge.c','mention-bridge.c'):raise OSError('NATIVE_SOURCE_INVALID')
    if not args.stop and fingerprint(ROOT/'integrations/wechat/native'/source_name)!=manifest['sourceSha256']:raise OSError('SOURCE_CHANGED_REBUILD_REQUIRED')
    process=k.OpenProcess(0x43a,False,pid)
    if not process:raise OSError('WECHAT_NATIVE_ACCESS_DENIED')
    try:
        path=c.create_unicode_buffer(32768);length=w.DWORD(len(path))
        if not k.QueryFullProcessImageNameW(process,0,path,c.byref(length)) or Path(path.value)!=EXE or fingerprint(EXE)!=EXE_SHA:
            raise OSError('CLIENT_IDENTITY_MISMATCH')
        rows=modules(pid)
        cores=[row for row in rows if row['name'].lower()=='weixin.dll']
        if len(cores)!=1 or fingerprint(cores[0]['path'])!=manifest['coreSha256']:raise OSError('CORE_IDENTITY_MISMATCH')
        exports=export_rvas(dll)
        matches=[row for row in rows if Path(row['path'])==dll]
        if args.stop:
            if len(matches)!=1:raise OSError('LOADED_MODULE_MISMATCH')
            if call(process,matches[0]['base']+exports['XiaoyuStop'])!=0:raise OSError('SERVER_STOP_NOT_CONFIRMED_NO_UNLOAD')
            if not call(process,remote_export(pid,'FreeLibrary'),matches[0]['base']):raise OSError('UNLOAD_FAILED')
            if any(Path(row['path'])==dll for row in modules(pid)):raise OSError('UNLOAD_NOT_CONFIRMED')
            state['stopped']=True;STATE.write_text(json.dumps(state,indent=2))
            print(json.dumps({'stopped':True,'unloaded':True,'pid':pid}));return
        if matches:raise OSError('ALREADY_LOADED_NO_DUPLICATE_LOAD')
        if not args.account_directory or len(args.account_directory)>128 or not 1024<=args.port<=65535 or not 1<=args.limit<=100000:
            parser.error('Account directory, port and submission limit must be explicit and valid')
        if not 0<=args.media_mask<=31 or args.media_mask&16 and not manifest.get('mentionsExperimental'):parser.error('Mention bit requires the exact experimental mention source')
        media_directory=Path(args.media_root).resolve() if args.media_root else ROOT/'data/wechat-native-research/outgoing'
        if not media_directory.is_relative_to((ROOT/'data').resolve()):raise OSError('NATIVE_MEDIA_ROOT_OUTSIDE_DATA')
        media_directory.mkdir(parents=True,exist_ok=True)
        if len(str(media_directory))>480:raise OSError('NATIVE_MEDIA_ROOT_TOO_LONG')
        env=dict(os.environ,XY_NATIVE_EXE=str(EXE),XY_NATIVE_CORE=cores[0]['path'])
        for key in list(env):
            if key.casefold()=='psmodulepath':del env[key]
        env['PSModulePath']=str(Path(os.environ['SystemRoot'])/'System32/WindowsPowerShell/v1.0/Modules')
        command="$ErrorActionPreference='Stop'; foreach($p in @($env:XY_NATIVE_EXE,$env:XY_NATIVE_CORE)) { $s=Get-AuthenticodeSignature -LiteralPath $p; if($s.Status -ne 'Valid' -or $s.SignerCertificate.Subject -notmatch 'Tencent') {throw 'SIGNATURE_INVALID'} }; 'VERIFIED'"
        check=subprocess.run([str(Path(os.environ['SystemRoot'])/'System32/WindowsPowerShell/v1.0/powershell.exe'),'-NoProfile','-NonInteractive','-Command',command],env=env,capture_output=True,timeout=30,creationflags=0x08000000)
        if check.returncode or b'VERIFIED' not in check.stdout:
            raise OSError('AUTHENTICODE_NOT_VERIFIED: '+check.stderr.decode('utf-8',errors='replace')[:400])
        token=secrets.token_hex(32)
        state={'pid':pid,'port':args.port,'token':token,'accountDirectory':args.account_directory,
               'dllSha256':manifest['dllSha256'],'dllPath':str(dll),'submissionLimit':args.limit,'loaded':False,'stopped':False,
               'mediaMask':args.media_mask,'mediaRoot':str(media_directory)}
        STATE.parent.mkdir(parents=True,exist_ok=True);STATE.write_text(json.dumps(state,indent=2))
        pointer=allocate(process,(str(dll)+'\0').encode('utf-16le'))
        result=call(process,remote_export(pid,'LoadLibraryW'),pointer)
        k.VirtualFreeEx(process,pointer,0,0x8000)
        matches=[row for row in modules(pid) if Path(row['path'])==dll]
        if len(matches)!=1:raise OSError(f'DLL_LOAD_NOT_CONFIRMED_{result}')
        state['loaded']=True;STATE.write_text(json.dumps(state,indent=2))
        config=start_config(pid,args.port,args.limit,token,args.account_directory,args.media_mask,media_directory) if protocol==2 else TextConfig(0x314e5958,pid,args.port,args.limit,token.encode(),args.account_directory.encode('ascii'))
        pointer=allocate(process,bytes(config))
        result=call(process,matches[0]['base']+exports['XiaoyuStart'],pointer)
        k.VirtualFreeEx(process,pointer,0,0x8000)
        if result:
            raise OSError(f'NATIVE_START_REFUSED_{result}_USE_STOP_TO_UNLOAD')
        request=urllib.request.Request(f'http://127.0.0.1:{args.port}/health',headers={'Authorization':'Bearer '+token})
        with urllib.request.urlopen(request,timeout=5) as response:health=json.load(response)
        if health.get('pid')!=pid or health.get('accountDirectory')!=args.account_directory or not health.get('verified'):
            raise OSError('NATIVE_HEALTH_NOT_VERIFIED')
        state['healthVerified']=True;STATE.write_text(json.dumps(state,indent=2))
        print(json.dumps({'loaded':True,'healthVerified':True,'pid':pid,'submissionLimit':args.limit,'dllSha256':manifest['dllSha256']}))
    finally:k.CloseHandle(process)


if __name__=='__main__':main()
