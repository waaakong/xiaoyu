"""Read-only voice-send evidence for the exact WeChat image. Never opens processes."""
import bisect
import importlib.util
import json
from pathlib import Path
import re
import struct
import sys

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'data/wechat-analysis-libs'))
spec=importlib.util.spec_from_file_location('analysis',ROOT/'scripts/wechat-native-analyze.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
image=module.Image(sys.argv[1]);summary=image.summary()
if summary['sha256']!='afe3d02c58bada3c35009c0cd58ee1f57b2a00fe53237d0dce649107fddb9a20':raise SystemExit('Exact image mismatch')
functions=sorted(image.functions)
def containing(rva):
    i=bisect.bisect_right(functions,rva)-1
    return functions[i] if i>=0 and rva<image.functions[functions[i]] else None
found={}
pattern=re.compile(rb'(?i)(?:send[^\x00\r\n]{0,45}(?:voice|audio)|(?:voice|audio)[^\x00\r\n]{0,35}(?:send|upload)|silk[^\x00\r\n]{0,70}|voicelength[^\x00\r\n]{0,70})')
for section in image.pe.sections:
    data=section.get_data()
    for m in pattern.finditer(data):
        start=data.rfind(b'\0',max(0,m.start()-100),m.start())+1
        if start==0:start=m.start()
        end=data.find(b'\0',m.end(),min(len(data),m.end()+160))
        if end<0:end=m.end()
        if end-start>300:continue
        found[section.VirtualAddress+start]={'rva':hex(section.VirtualAddress+start),'text':data[start:end].decode('utf8','replace'),'references':[]}
assignments=[]
for base,data in image.executable:
    for m in re.finditer(rb'[\x48\x4c][\x8d\x8b][\x05\x0d\x15\x1d\x25\x2d\x35\x3d]',data):
        at=m.start()
        if at+7>len(data):continue
        target=base+at+7+struct.unpack_from('<i',data,at+3)[0]
        if target in found:found[target]['references'].append({'instruction':hex(base+at),'function':hex(containing(base+at) or 0)})
    for m in re.finditer(rb'\xc7[\x80-\x87]\x18\x01\x00\x00\x22\x00\x00\x00',data):
        assignments.append({'instruction':hex(base+m.start()),'function':hex(containing(base+m.start()) or 0)})
result={**summary,'loaded':False,'abiValidated':False,'strings':list(found.values()),'type34Assignments':assignments}
out=Path(sys.argv[2]);out.parent.mkdir(parents=True,exist_ok=True);out.write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf8')
print(json.dumps({'strings':len(found),'referenced':sum(bool(v['references']) for v in found.values()),'type34Assignments':assignments,'loaded':False}))
