"""Offline SNS evidence only: reads a PE, never opens a process or loads code."""
import argparse
import bisect
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import struct
import sys

ROOT=Path(__file__).resolve().parents[1]
EXPECTED='afe3d02c58bada3c35009c0cd58ee1f57b2a00fe53237d0dce649107fddb9a20'

def analyze(file):
    sys.path.insert(0,str(ROOT/'data/wechat-analysis-libs'))
    spec=importlib.util.spec_from_file_location('native_analysis',ROOT/'scripts/wechat-native-analyze.py')
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    image=module.Image(file)
    if hashlib.sha256(image.data).hexdigest()!=EXPECTED:raise ValueError('Exact Weixin.dll build mismatch')
    pattern=re.compile(rb'(?i)(?:mmsnspost|sns.?post|sns.?upload|mmsnsupload|TimelineObject|SnsObject|SnsPublish)[^\x00\r\n]{0,100}')
    found={}
    for section in image.pe.sections:
        if section.Characteristics&0x20000000:continue
        data=section.get_data()
        for match in pattern.finditer(data):
            start=max(match.start()-120,data.rfind(b'\x00',max(0,match.start()-120),match.start())+1)
            end=data.find(b'\x00',match.end(),min(len(data),match.end()+150))
            if end<0:end=match.end()
            if end-start>500:continue
            rva=section.VirtualAddress+start
            found[rva]={'rva':hex(rva),'text':data[start:end].decode('utf-8','replace'),'references':[]}
    functions=sorted(image.functions)
    def containing(rva):
        i=bisect.bisect_right(functions,rva)-1
        begin=functions[i] if i>=0 else None
        return begin if begin is not None and rva<image.functions[begin] else None
    for base,data in image.executable:
        for match in re.finditer(rb'(?:[\x48\x4c][\x8d\x8b]|\x0f[\x10\x28\x6f])[\x05\x0d\x15\x1d\x25\x2d\x35\x3d]',data):
            at=match.start()
            if at+7>len(data):continue
            target=base+at+7+struct.unpack_from('<i',data,at+3)[0]
            if target not in found:continue
            fn=containing(base+at)
            if fn is not None:found[target]['references'].append({'instruction':hex(base+at),'function':hex(fn),'bytes':image.functions[fn]-fn})
    return {'image':image.summary(),'strings':sorted(found.values(),key=lambda v:int(v['rva'],16)),'abiValidated':False,'componentLoaded':False,'notice':'Static references are not proof of a callable ABI or successful publishing.'}

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--file',required=True);p.add_argument('--output',required=True);a=p.parse_args()
    result=analyze(a.file);out=Path(a.output);out.parent.mkdir(parents=True,exist_ok=True);out.write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({'strings':len(result['strings']),'referenced':sum(bool(s['references']) for s in result['strings']),'abiValidated':False,'componentLoaded':False}))
