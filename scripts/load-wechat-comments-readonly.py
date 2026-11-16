"""Load one reviewed comment/detail component in read-only, one-object, one-query mode.
Loading does not query or send. The explicit query is a separate reviewed step.
"""
import argparse,hashlib,importlib.util,json,os,re,secrets,socket,struct,subprocess,time,urllib.request
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];BASE=ROOT/'data/wechat-comments-research'
def read(p):return json.loads(Path(p).read_text(encoding='utf-8-sig'))
def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def health(port,token):
 req=urllib.request.Request(f'http://127.0.0.1:{port}/health',headers={'Authorization':'Bearer '+token})
 with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(req,timeout=3) as response:return json.load(response)
def main():
 p=argparse.ArgumentParser();p.add_argument('--approved-sha256',required=True);p.add_argument('--object-id',required=True);p.add_argument('--port',type=int,default=11349);a=p.parse_args()
 if not re.fullmatch('[1-9][0-9]{0,19}',a.object_id) or int(a.object_id)>0xffffffffffffffff or not 1024<=a.port<=65535:raise ValueError('INVALID_READ_TARGET')
 manifest=read(BASE/'build/manifest.json');dll=Path(manifest['dllPath'])
 if manifest.get('offlineTest') is not False or sha(dll)!=a.approved_sha256 or manifest['dllSha256']!=a.approved_sha256 or sha(ROOT/'integrations/wechat/comment-native/comments-bridge.c')!=manifest['sourceSha256'] or sha(ROOT/'integrations/wechat/social-native/identity.h')!=manifest['identitySha256']:raise ValueError('APPROVED_FILES_MISMATCH')
 native=read(ROOT/'data/wechat-native-research/session.json');h=health(native['port'],native['token']);account=h.get('accountDirectory','');wxid=read(ROOT/'data/wechat-connection.json').get('account','');pid=native['pid']
 if h.get('verified') is not True or h.get('pid')!=pid or not re.fullmatch('wxid_[A-Za-z0-9_]{1,100}',wxid) or not account.startswith(wxid+'_'):raise ValueError('CURRENT_WECHAT_IDENTITY_UNVERIFIED')
 spec=importlib.util.spec_from_file_location('loader',ROOT/'scripts/load-wechat-native.py');loader=importlib.util.module_from_spec(spec);spec.loader.exec_module(loader)
 rows=loader.modules(pid);cores=[r for r in rows if Path(r['path']).name.lower()=='weixin.dll'];exes=[r for r in rows if Path(r['path']).name.lower()=='weixin.exe']
 if len(cores)!=1 or len(exes)!=1 or sha(cores[0]['path'])!=manifest['coreSha256'] or sha(exes[0]['path'])!=loader.EXE_SHA:raise ValueError('EXACT_CLIENT_MISMATCH')
 if any(Path(r['path']).name.lower()==dll.name.lower() for r in rows):raise ValueError('COMPONENT_ALREADY_LOADED_NO_RETRY')
 env=dict(os.environ,XY_COMMENT_CORE=cores[0]['path'],XY_COMMENT_EXE=exes[0]['path'])
 for key in list(env):
  if key.casefold()=='psmodulepath':del env[key]
 env['PSModulePath']=str(Path(os.environ['SystemRoot'])/'System32/WindowsPowerShell/v1.0/Modules')
 command="$ErrorActionPreference='Stop';foreach($p in @($env:XY_COMMENT_CORE,$env:XY_COMMENT_EXE)){$s=Get-AuthenticodeSignature -LiteralPath $p;if($s.Status -ne 'Valid' -or $s.SignerCertificate.Subject -notmatch 'Tencent'){throw 'SIGNATURE_INVALID'}}; 'VERIFIED'"
 check=subprocess.run([str(Path(os.environ['SystemRoot'])/'System32/WindowsPowerShell/v1.0/powershell.exe'),'-NoProfile','-NonInteractive','-Command',command],env=env,capture_output=True,timeout=30)
 if check.returncode or b'VERIFIED' not in check.stdout:raise ValueError('TENCENT_SIGNATURE_NOT_VERIFIED')
 session_file=BASE/'session.json'
 if session_file.exists() and read(session_file).get('pid')==pid:raise ValueError('PREVIOUS_LOAD_ATTEMPT_NO_RETRY')
 with socket.socket() as probe:probe.bind(('127.0.0.1',a.port))
 exports=loader.export_rvas(dll,required={'XiaoyuCommentsStart','XiaoyuCommentsStop','XiaoyuCommentsValidate','XiaoyuCommentsParse'});token=secrets.token_hex(32)
 def field(value,n):
  b=value.encode('utf-8')
  if len(b)>=n:raise ValueError('FIELD_OVERFLOW')
  return b+bytes(n-len(b))
 config=struct.pack('<4I65s129s129s65sII4xQ',0x364d5958,424,pid,a.port,field(token,65),field(account,129),field(wxid,129),field('0'*64,65),1,0,int(a.object_id))
 process=loader.k.OpenProcess(0x43a,False,pid)
 if not process:raise OSError('PROCESS_UNAVAILABLE')
 state={'pid':pid,'port':a.port,'token':token,'wxid':wxid,'objectId':a.object_id,'accountDirectory':account,'dllSha256':a.approved_sha256,'dllPath':str(dll),'loaded':False,'healthVerified':False,'maxReads':1,'allowComment':False,'approvedForApp':False,'validated':False}
 try:
  session_file.write_text(json.dumps(state,indent=2),encoding='utf-8');session_file.chmod(0o600)
  address=loader.allocate(process,(str(dll.resolve())+'\0').encode('utf-16le'));loader.call(process,loader.remote_export(pid,'LoadLibraryW'),address);loader.k.VirtualFreeEx(process,address,0,0x8000)
  loaded=[r for r in loader.modules(pid) if Path(r['path']).resolve()==dll.resolve()]
  if len(loaded)!=1:raise OSError('LOAD_RESULT_UNKNOWN_NO_RETRY')
  state['loaded']=True;session_file.write_text(json.dumps(state,indent=2),encoding='utf-8');address=loader.allocate(process,config);code=loader.call(process,loaded[0]['base']+exports['XiaoyuCommentsStart'],address);loader.k.VirtualFreeEx(process,address,0,0x8000)
  if code:raise OSError('COMPONENT_START_REFUSED_'+str(code))
  for _ in range(10):
   try:
    h=health(a.port,token)
    if h.get('integration')=='XiaoyuComments-1' and h.get('pid')==pid and h.get('verified') is True and h.get('offlineTest') is False and h.get('maxReads')==1 and h.get('allowComment') is False and h.get('allowedObject')==a.object_id:state['healthVerified']=True;break
   except (OSError,ValueError):pass
   time.sleep(.2)
  if not state['healthVerified']:raise OSError('HEALTH_UNKNOWN_NO_QUERY_OR_RETRY')
 finally:
  loader.k.CloseHandle(process);session_file.write_text(json.dumps(state,indent=2),encoding='utf-8');session_file.chmod(0o600)
 print(json.dumps({k:state[k] for k in ['pid','loaded','healthVerified','objectId','maxReads','allowComment','dllSha256']}))
if __name__=='__main__':main()
