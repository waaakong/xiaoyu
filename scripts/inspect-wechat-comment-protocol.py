"""Run at most three explicitly approved synthetic parser fixtures in an already loaded probe.
No LoadLibrary, hooks, account content, network dispatch or comments.
"""
import argparse,hashlib,importlib.util,json,struct
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];BASE=ROOT/'data/wechat-comments-research';BUILD=BASE/'build-probe'
def read(p):return json.loads(Path(p).read_text(encoding='utf-8-sig'))
def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def main():
 p=argparse.ArgumentParser();p.add_argument('--approved-dll-sha256',required=True);p.add_argument('--approved-fixtures-sha256',required=True);a=p.parse_args()
 manifest=read(BUILD/'manifest.json');dll=Path(manifest['dllPath']);fixture=BASE/'parser-fixtures.json'
 if a.approved_dll_sha256!=manifest['dllSha256'] or sha(dll)!=a.approved_dll_sha256:raise ValueError('APPROVED_DLL_MISMATCH')
 if sha(fixture)!=a.approved_fixtures_sha256:raise ValueError('APPROVED_FIXTURES_MISMATCH')
 proposal=read(fixture);cases=proposal.get('cases',[])
 if proposal.get('networkDispatch') is not False or proposal.get('realAccount') is not False or proposal.get('realPost') is not False or not 1<=len(cases)<=3:raise ValueError('FIXTURE_SCOPE_INVALID')
 packets=[]
 for item in cases:
  data=bytes.fromhex(item['protobufHex'])
  if not 1<=len(data)<=1024:raise ValueError('FIXTURE_SIZE_INVALID')
  packets.append(data)
 prior=read(BUILD/'attempt.json');pid=prior['pid']
 if prior.get('status')!='returned' or prior.get('dllSha256')!=a.approved_dll_sha256:raise ValueError('FIRST_DIAGNOSTIC_NOT_CONFIRMED')
 spec=importlib.util.spec_from_file_location('loader',ROOT/'scripts/load-wechat-native.py');loader=importlib.util.module_from_spec(spec);spec.loader.exec_module(loader)
 rows=loader.modules(pid);cores=[r for r in rows if Path(r['path']).name.lower()=='weixin.dll'];loaded=[r for r in rows if Path(r['path']).resolve()==dll.resolve()]
 if len(cores)!=1 or sha(cores[0]['path'])!=manifest['coreSha256'] or len(loaded)!=1:raise ValueError('LOADED_PROCESS_OR_MODULE_MISMATCH')
 exports=loader.export_rvas(dll,required={'XiaoyuCommentProbe'});record=BASE/('parser-attempt-'+a.approved_fixtures_sha256[:16]+'.json')
 if record.exists():raise ValueError('ALREADY_ATTEMPTED_NO_REPLAY')
 process=loader.k.OpenProcess(0x43a,False,pid)
 if not process:raise OSError('PROCESS_UNAVAILABLE')
 report={'pid':pid,'dllSha256':a.approved_dll_sha256,'fixturesSha256':a.approved_fixtures_sha256,'results':[],'status':'running','sentComments':0,'networkDispatch':False}
 try:
  record.write_text(json.dumps(report,indent=2),encoding='utf-8')
  for i,data in enumerate(packets):
   report['currentCase']=i;record.write_text(json.dumps(report,indent=2),encoding='utf-8')
   packet=struct.pack('<IIII',0x31504358,pid,len(data),0)+data+bytes(1024-len(data));address=loader.allocate(process,packet)
   code=loader.call(process,loaded[0]['base']+exports['XiaoyuCommentProbe'],address,timeout=10000);loader.k.VirtualFreeEx(process,address,0,0x8000)
   report['results'].append({'case':i,'code':code,'parsed':bool(code&16),'initialized':bool(code&1)})
   if code not in [256,272,273]:raise ValueError('UNEXPECTED_RESULT_STOPPED')
   record.write_text(json.dumps(report,indent=2),encoding='utf-8')
  report['status']='returned';record.write_text(json.dumps(report,indent=2),encoding='utf-8');print(json.dumps(report))
 finally:loader.k.CloseHandle(process)
if __name__=='__main__':main()
