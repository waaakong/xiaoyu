"""Bounded read-only probe for one exact-build appmsg callback object.

Reads private writable pages, searches a single verified callback vtable value,
and saves pointer metadata only. Never writes process memory, executes a remote
thread, installs a hook, or saves arbitrary heap content/chat text.
"""
import bisect
import ctypes as c
from ctypes import wintypes as w
import importlib.util
import json
from pathlib import Path
import struct
import sys
import time

ROOT=Path(__file__).resolve().parents[1]

def main():
    sys.path.insert(0,str(ROOT/'data/wechat-analysis-libs'))
    spec=importlib.util.spec_from_file_location('native_analysis',ROOT/'scripts/wechat-native-analyze.py');analysis=importlib.util.module_from_spec(spec);spec.loader.exec_module(analysis)
    spec=importlib.util.spec_from_file_location('owned_loader',ROOT/'scripts/load-wechat-native.py');loader=importlib.util.module_from_spec(spec);spec.loader.exec_module(loader)
    session=json.loads((ROOT/'data/wechat-native-research/session.json').read_text(encoding='utf8'))
    core=[m for m in loader.modules(session['pid']) if Path(m['path']).name.lower()=='weixin.dll']
    if len(core)!=1 or loader.fingerprint(core[0]['path'])!='afe3d02c58bada3c35009c0cd58ee1f57b2a00fe53237d0dce649107fddb9a20':raise ValueError('exact core identity mismatch')
    image=analysis.Image(core[0]['path']);base=core[0]['base'];size=image.pe.OPTIONAL_HEADER.SizeOfImage
    k=loader.k;k.ReadProcessMemory.argtypes=[w.HANDLE,c.c_void_p,c.c_void_p,c.c_size_t,c.POINTER(c.c_size_t)];k.ReadProcessMemory.restype=w.BOOL
    class MBI(c.Structure):
        _fields_=[('base',c.c_void_p),('allocation',c.c_void_p),('allocation_protect',w.DWORD),('partition',w.WORD),('region_size',c.c_size_t),('state',w.DWORD),('protect',w.DWORD),('kind',w.DWORD)]
    k.VirtualQueryEx.argtypes=[w.HANDLE,c.c_void_p,c.POINTER(MBI),c.c_size_t];k.VirtualQueryEx.restype=c.c_size_t
    process=k.OpenProcess(0x410,False,session['pid'])
    if not process:raise OSError('read-only process access unavailable')
    def read(address,length):
        b=c.create_string_buffer(length);got=c.c_size_t()
        if not k.ReadProcessMemory(process,address,b,length,c.byref(got)):return b''
        return b.raw[:got.value]
    found=[];scanned=0;address=0;started=time.monotonic();needle=struct.pack('<Q',base+0x9818348);root_evidence=None
    try:
        root_value=read(base+0xbd0fdf0,8)
        if len(root_value)==8:
            root=struct.unpack('<Q',root_value)[0];table_value=read(root,8)
            if len(table_value)==8:
                table=struct.unpack('<Q',table_value)[0];getter_value=read(table+16,8)
                if len(getter_value)==8:
                    getter=struct.unpack('<Q',getter_value)[0]
                    if base<getter<base+size:
                        from capstone import Cs,CS_ARCH_X86,CS_MODE_64
                        code=image.read(getter-base,32)
                        root_evidence={'rootGlobalRva':'0xbd0fdf0','rootVtableRva':hex(table-base),'getterRva':hex(getter-base),'getterInstructions':[x.mnemonic+' '+x.op_str for x in Cs(CS_ARCH_X86,CS_MODE_64).disasm(code,getter-base)][:6]}
                        if code[:8]==b'\x48\x8b\x81\xc8\x02\x00\x00\xc3':
                            value=read(root+0x2c8,8)
                            if len(value)==8:
                                manager=struct.unpack('<Q',value)[0];value=read(manager,8)
                                if len(value)==8:
                                    manager_table=struct.unpack('<Q',value)[0];slot=read(manager_table+40,8)
                                    if base<manager_table<base+size and len(slot)==8:
                                        method=struct.unpack('<Q',slot)[0]
                                        if base<method<base+size:
                                            root_evidence.update({'managerField':'0x2c8','managerVtableRva':hex(manager_table-base),'dispatchRva':hex(method-base),'dispatchSlot':5,'readOnlyPointerChainVerified':True})
        while address<0x7fffffffffff and scanned<512*1024*1024 and time.monotonic()-started<8:
            info=MBI()
            if not k.VirtualQueryEx(process,address,c.byref(info),c.sizeof(info)):break
            current=info.base or 0;address=current+info.region_size
            if info.state!=0x1000 or info.kind!=0x20000 or info.protect&0x100 or info.protect&0xff not in (4,8):continue
            for start in range(current,address,1024*1024):
                if scanned>=512*1024*1024 or time.monotonic()-started>=8:break
                data=read(start,min(1024*1024+64,address-start));scanned+=len(data);offset=0
                while True:
                    offset=data.find(needle,offset)
                    if offset<0:break
                    position=start+offset;offset+=8
                    if position%8:continue
                    pointer=read(position+8,8)
                    if len(pointer)!=8:continue
                    manager=struct.unpack('<Q',pointer)[0];value=read(manager,8)
                    if len(value)!=8:continue
                    table=struct.unpack('<Q',value)[0]
                    if not base<table<base+size:continue
                    slots=read(table,48)
                    if len(slots)!=48:continue
                    submit=struct.unpack_from('<Q',slots,40)[0]
                    if submit-base not in image.functions:continue
                    found.append({'callback':hex(position),'manager':hex(manager),'vtableRva':hex(table-base),'dispatchRva':hex(submit-base)})
    finally:k.CloseHandle(process)
    result={'pid':session['pid'],'coreBase':hex(base),'coreSha256':loader.fingerprint(core[0]['path']),'readOnly':True,'rootEvidence':root_evidence,'scannedBytes':scanned,'elapsedMs':round((time.monotonic()-started)*1000),'candidates':found[:20],'abiValidated':False,'notice':'Pointers are observations only; lifetime and send ABI are not proven.'}
    target=ROOT/'data/wechat-social-research/manager-probe.private.json';target.write_text(json.dumps(result,indent=2),encoding='utf8');target.chmod(0o600)
    print(json.dumps({'readOnly':True,'rootEvidence':root_evidence,'candidateCount':len(found),'scannedMiB':round(scanned/1024/1024),'elapsedMs':result['elapsedMs'],'abiValidated':False}))

if __name__=='__main__':main()
