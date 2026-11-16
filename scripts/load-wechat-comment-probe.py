"""Explicitly reviewed, one-run constructor/parser diagnostic. Never sends a comment.
The operator must obtain approval for the exact manifest hash before invoking this file.
"""
import argparse,ctypes as c,hashlib,importlib.util,json,os,struct,subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
BASE=ROOT/'data/wechat-comments-research/build-probe'
def read(p):return json.loads(Path(p).read_text(encoding='utf-8-sig'))
def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def main():
 p=argparse.ArgumentParser();p.add_argument('--approved-sha256',required=True);p.add_argument('--pid',type=int);args=p.parse_args()
 manifest=read(BASE/'manifest.json');dll=Path(manifest['dllPath']);source=ROOT/'integrations/wechat/comment-native/comment-probe.c'
 if args.approved_sha256!=manifest['dllSha256'] or sha(dll)!=args.approved_sha256 or sha(source)!=manifest['sourceSha256']:raise ValueError('APPROVED_FILE_MISMATCH')
 session=read(ROOT/'data/wechat-native-research/session.json');pid=args.pid or session['pid']
 if pid<1:raise ValueError('INVALID_PID')
 spec=importlib.util.spec_from_file_location('native_loader',ROOT/'scripts/load-wechat-native.py');loader=importlib.util.module_from_spec(spec);spec.loader.exec_module(loader)
 rows=loader.modules(pid);cores=[r for r in rows if Path(r['path']).name.lower()=='weixin.dll']
 if len(cores)!=1 or sha(cores[0]['path'])!=manifest['coreSha256']:raise ValueError('EXACT_CLIENT_MISMATCH')
 if any(Path(r['path']).name.lower()==dll.name.lower() for r in rows):raise ValueError('PROBE_ALREADY_LOADED_NO_RETRY')
 env=dict(os.environ,XY_COMMENT_CORE=cores[0]['path'])
 for key in list(env):
  if key.casefold()=='psmodulepath':del env[key]
 env['PSModulePath']=str(Path(os.environ['SystemRoot'])/'System32/WindowsPowerShell/v1.0/Modules')
 verified=subprocess.run([str(Path(os.environ['SystemRoot'])/'System32/WindowsPowerShell/v1.0/powershell.exe'),'-NoProfile','-NonInteractive','-Command',"$s=Get-AuthenticodeSignature -LiteralPath $env:XY_COMMENT_CORE; if($s.Status -ne 'Valid' -or $s.SignerCertificate.Subject -notmatch 'Tencent'){exit 1}"],env=env,capture_output=True,timeout=20)
 if verified.returncode:raise ValueError('TENCENT_SIGNATURE_NOT_VERIFIED: '+verified.stderr.decode('utf-8',errors='replace')[:300])
 record=BASE/'attempt.json'
 if record.exists():raise ValueError('PROBE_ALREADY_ATTEMPTED_NO_RETRY')
 exports=loader.export_rvas(dll,required={'XiaoyuCommentProbe'});process=loader.k.OpenProcess(0x43a,False,pid)
 if not process:raise OSError('PROCESS_UNAVAILABLE')
 record.write_text(json.dumps({'status':'loading','pid':pid,'dllSha256':args.approved_sha256}),encoding='utf-8')
 try:
  address=loader.allocate(process,(str(dll.resolve())+'\0').encode('utf-16le'));loader.call(process,loader.remote_export(pid,'LoadLibraryW'),address)
  loader.k.VirtualFreeEx(process,address,0,0x8000)
  loaded=[r for r in loader.modules(pid) if Path(r['path']).resolve()==dll.resolve()]
  if len(loaded)!=1:raise OSError('LOAD_RESULT_UNKNOWN_NO_RETRY')
  # Synthetic empty submessages, no real account, post, author, comment or text.
  data=bytes.fromhex('0a0012001a00');packet=struct.pack('<IIII',0x31504358,pid,len(data),0)+data+bytes(1024-len(data))
  address=loader.allocate(process,packet);result=loader.call(process,loaded[0]['base']+exports['XiaoyuCommentProbe'],address,timeout=10000)
  loader.k.VirtualFreeEx(process,address,0,0x8000)
  report={'status':'returned','pid':pid,'code':result,'parsed':bool(result&16),'initialized':bool(result&1),'dllSha256':args.approved_sha256,'sentComments':0,'networkDispatch':False}
  record.write_text(json.dumps(report,indent=2),encoding='utf-8');print(json.dumps(report))
 finally:loader.k.CloseHandle(process)
if __name__=='__main__':main()
