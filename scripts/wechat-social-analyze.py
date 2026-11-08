"""Offline-only social-message evidence. Does not load a DLL or open a process."""
import argparse
import bisect
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import struct
import sys

def analyze(file):
    sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'data/wechat-analysis-libs'))
    spec=importlib.util.spec_from_file_location('native_analysis',Path(__file__).with_name('wechat-native-analyze.py'))
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    image=module.Image(file)
    needles=re.compile(rb'(?i)(?:send[^\x00\r\n]{0,30}(?:patmsg|pat_msg|poke|refermsg|refer_msg|recordmsg|record_msg|appmsg|app_msg)|(?:patmsg|refermsg|recordmsg|sendpat|send_poke|sendforward)[^\x00\r\n]{0,100})')
    found={}
    for section in image.pe.sections:
        data=section.get_data()
        for match in needles.finditer(data):
            start=max(match.start()-160,data.rfind(b'\x00',max(0,match.start()-160),match.start())+1)
            end=data.find(b'\x00',match.end(),min(len(data),match.end()+160))
            if end<0:end=match.end()
            value=data[start:end]
            if len(value)>350:continue
            found[section.VirtualAddress+start]={'rva':hex(section.VirtualAddress+start),'text':value.decode('utf-8','replace'),'references':[]}
    functions=sorted(image.functions)
    for base,data in image.executable:
        for match in re.finditer(rb'[\x48\x4c][\x8d\x8b][\x05\x0d\x15\x1d\x25\x2d\x35\x3d]',data):
            offset=match.start()
            if offset+7>len(data):continue
            target=base+offset+7+struct.unpack_from('<i',data,offset+3)[0]
            # Most references point to the beginning; a few point after a prefix.
            if target not in found:continue
            index=bisect.bisect_right(functions,base+offset)-1
            begin=functions[index] if index>=0 else None
            if begin is not None and base+offset<image.functions[begin]:found[target]['references'].append({'instruction':hex(base+offset),'function':hex(begin),'bytes':image.functions[begin]-begin})
    def containing(rva):
        index=bisect.bisect_right(functions,rva)-1
        begin=functions[index] if index>=0 else None
        return begin if begin is not None and rva<image.functions[begin] else None
    constructors=set()
    for base,data in image.executable:
        for match in re.finditer(b'\xe8',data):
            offset=match.start()
            if offset+5>len(data):continue
            if base+offset+5+struct.unpack_from('<i',data,offset+1)[0]==0x790eb0:
                begin=containing(base+offset)
                if begin is not None:constructors.add(begin)
    factories={rva:[] for rva in constructors};type49=[]
    for base,data in image.executable:
        for match in re.finditer(b'\xe8',data):
            offset=match.start()
            if offset+5>len(data):continue
            target=base+offset+5+struct.unpack_from('<i',data,offset+1)[0]
            if target in factories:
                begin=containing(base+offset)
                if begin is not None:factories[target].append(hex(begin))
        for match in re.finditer(rb'\xc7[\x80-\x87][\x18\x28]\x01\x00\x00\x31\x00\x00\x00',data):
            begin=containing(base+match.start())
            if begin is not None:type49.append({'instruction':hex(base+match.start()),'function':hex(begin)})
    return {'file':str(file),'sha256':hashlib.sha256(image.data).hexdigest(),'loaded':False,'abiValidated':False,'candidates':list(found.values()),
            'messageDerivedConstructors':[{'rva':hex(rva),'bytes':image.functions[rva]-rva,'callers':sorted(set(callers))[:30]} for rva,callers in sorted(factories.items())],
            'type49Assignments':type49,'notice':'Addresses and structural matches are research evidence only, not validated call signatures.'}

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--file',required=True);parser.add_argument('--output',required=True);args=parser.parse_args()
    result=analyze(args.file);Path(args.output).parent.mkdir(parents=True,exist_ok=True);Path(args.output).write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf8')
    print(json.dumps({'strings':len(result['candidates']),'referenced':sum(bool(r['references']) for r in result['candidates']),'abiValidated':False}))
