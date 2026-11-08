"""Bounded offline disassembly/data references. No process APIs."""
import argparse
import bisect
import importlib.util
import json
from pathlib import Path
import re
import struct
import sys

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'data/wechat-analysis-libs'))
spec=importlib.util.spec_from_file_location('analysis',ROOT/'scripts/wechat-native-analyze.py');a=importlib.util.module_from_spec(spec);spec.loader.exec_module(a)
from capstone import Cs,CS_ARCH_X86,CS_MODE_64
from capstone.x86_const import X86_OP_IMM,X86_OP_MEM,X86_REG_RIP

def inspect(file,rvas):
    image=a.Image(file);base=image.pe.OPTIONAL_HEADER.ImageBase;decoder=Cs(CS_ARCH_X86,CS_MODE_64);decoder.detail=True
    result={'sha256':image.summary()['sha256'],'items':[]};functions=sorted(image.functions)
    for rva in rvas:
        row={'rva':hex(rva),'qwordReferences':[],'codeReferences':[]};needle=struct.pack('<Q',base+rva);pos=0
        while len(row['qwordReferences'])<80:
            pos=image.data.find(needle,pos)
            if pos<0:break
            ref=image.pe.get_rva_from_offset(pos);pos+=1
            try:surround=image.read(max(0,ref-32),112).hex()
            except ValueError:surround=''
            row['qwordReferences'].append({'rva':hex(ref),'around':surround})
        for start,data in image.executable:
            for match in re.finditer(rb'(?:[\x48\x4c][\x8d\x8b]|\x0f[\x10\x28\x6f])[\x05\x0d\x15\x1d\x25\x2d\x35\x3d]',data):
                at=match.start()
                if at+7>len(data):continue
                target=start+at+7+struct.unpack_from('<i',data,at+3)[0]
                if target!=rva:continue
                i=bisect.bisect_right(functions,start+at)-1;fn=functions[i] if i>=0 else 0
                row['codeReferences'].append({'at':hex(start+at),'function':hex(fn)})
        if rva in image.functions:
            length=image.functions[rva]-rva;row['length']=length
            row['instructions']=[{'at':hex(i.address),'op':i.mnemonic+' '+i.op_str} for i in decoder.disasm(image.read(rva,min(length,16000)),rva)]
        result['items'].append(row)
    return result

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--file',required=True);p.add_argument('--rvas',nargs='+',required=True);p.add_argument('--output',required=True);args=p.parse_args()
    result=inspect(args.file,[int(r,0) for r in args.rvas]);Path(args.output).write_text(json.dumps(result,indent=2),encoding='utf-8');print(json.dumps({'items':len(result['items']),'output':args.output,'processOpened':False}))
