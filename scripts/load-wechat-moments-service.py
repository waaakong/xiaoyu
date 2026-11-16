"""Load the exact reviewed own-Moments service. Loading does not query or send.
App policy and HMAC authorize later requests; automatic replies default off.
"""
import argparse,hashlib,importlib.util,json,os,re,secrets,socket,struct,subprocess,time,urllib.request
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
BASE=None
DATA=None
def read(p):return json.loads(Path(p).read_text(encoding='utf-8-sig'))
def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def health(port,token):
 req=urllib.request.Request(f'http://127.0.0.1:{port}/health',headers={'Authorization':'Bearer '+token})
 with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(req,timeout=3) as response:return json.load(response)
def main():
 global BASE,DATA
 p=argparse.ArgumentParser();p.add_argument('--approved-sha256',required=True);p.add_argument('--data-dir',default=str(ROOT/'data'));p.add_argument('--preflight',action='store_true');p.add_argument('--port',type=int,default=11352);a=p.parse_args();DATA=Path(a.data_dir).resolve();BASE=DATA/'wechat-comments-research'
 if not 1024<=a.port<=65535:raise ValueError('INVALID_READ_TARGET')
 manifest=read(BASE/'build-service/manifest.json');dll=Path(manifest['dllPath'])
 if dll.resolve()!=(BASE/'build-service/XiaoyuWechatMomentsService.dll').resolve() or manifest.get('scope')!='own-moments' or manifest.get('offlineTest') is not False or sha(dll)!=a.approved_sha256 or manifest['dllSha256']!=a.approved_sha256 or sha(ROOT/'integrations/wechat/comment-native/moments-service.c')!=manifest['sourceSha256'] or sha(ROOT/'integrations/wechat/social-native/identity.h')!=manifest['identitySha256']:raise ValueError('APPROVED_FILES_MISMATCH')
 native=read(DATA/'wechat-native-research/session.json');h=health(native['port'],native['token']);account=h.get('accountDirectory','');wxid=read(DATA/'wechat-connection.json').get('account','');pid=native['pid']
 if h.get('verified') is not True or h.get('pid')!=pid or not re.fullmatch('wxid_[A-Za-z0-9_]{1,100}',wxid) or not account.startswith(wxid+'_'):raise ValueError('CURRENT_WECHAT_IDENTITY_UNVERIFIED')
 spec=importlib.util.spec_from_file_location('loader',ROOT/'scripts/load-wechat-native.py');loader=importlib.util.module_from_spec(spec);spec.loader.exec_module(loader)
 rows=loader.modules(pid);cores=[r for r in rows if Path(r['path']).name.lower()=='weixin.dll'];exes=[r for r in rows if Path(r['path']).name.lower()=='weixin.exe']
 if len(cores)!=1 or len(exes)!=1 or sha(cores[0]['path'])!=manifest['coreSha256'] or sha(exes[0]['path'])!=loader.EXE_SHA:raise ValueError('EXACT_CLIENT_MISMATCH')
 loaded=[r for r in rows if Path(r['path']).resolve()==dll.resolve()]
 env=dict(os.environ,XY_COMMENT_CORE=cores[0]['path'],XY_COMMENT_EXE=exes[0]['path'])
 for key in list(env):
  if key.casefold()=='psmodulepath':del env[key]
 env['PSModulePath']=str(Path(os.environ['SystemRoot'])/'System32/WindowsPowerShell/v1.0/Modules')
 command="$ErrorActionPreference='Stop';foreach($p in @($env:XY_COMMENT_CORE,$env:XY_COMMENT_EXE)){$s=Get-AuthenticodeSignature -LiteralPath $p;if($s.Status -ne 'Valid' -or $s.SignerCertificate.Subject -notmatch 'Tencent'){throw 'SIGNATURE_INVALID'}}; 'VERIFIED'"
 check=subprocess.run([str(Path(os.environ['SystemRoot'])/'System32/WindowsPowerShell/v1.0/powershell.exe'),'-NoProfile','-NonInteractive','-Command',command],env=env,capture_output=True,timeout=30)
 if check.returncode or b'VERIFIED' not in check.stdout:raise ValueError('TENCENT_SIGNATURE_NOT_VERIFIED')
 session_file=BASE/'service-session.json'
 if session_file.exists() and read(session_file).get('pid')==pid:
  old=read(session_file)
  if len(loaded)==1 and old.get('dllSha256')==a.approved_sha256 and old.get('wxid')==wxid and old.get('healthVerified'):
   previous=health(old['port'],old['token'])
   if previous.get('integration')=='XiaoyuMomentsService-1' and previous.get('scope')=='own-moments' and previous.get('pid')==pid and previous.get('verified') is True:
    print(json.dumps({'reused':True,'pid':pid,'healthVerified':True,'preflight':a.preflight}));return
  raise ValueError('PREVIOUS_LOAD_ATTEMPT_NO_RETRY')
 if loaded:raise ValueError('LOADED_COMPONENT_SESSION_MISSING_RESTART_WECHAT')
 with socket.socket() as probe:probe.bind(('127.0.0.1',a.port))
 exports=loader.export_rvas(dll,required={'XiaoyuMomentsServiceStart','XiaoyuMomentsServiceStop','XiaoyuMomentsServiceValidate','XiaoyuMomentsServiceParse'});token=secrets.token_hex(32);signing_key=secrets.token_hex(32)
 if a.preflight:
  print(json.dumps({'preflight':True,'pid':pid,'scope':'own-moments','wxid':wxid,'dllSha256':a.approved_sha256,'loaded':False}));return
 def field(value,n):
  b=value.encode('utf-8')
  if len(b)>=n:raise ValueError('FIELD_OVERFLOW')
  return b+bytes(n-len(b))
 config=struct.pack('<4I65s129s129s65sII4xQ',0x384d5958,424,pid,a.port,field(token,65),field(account,129),field(wxid,129),field(signing_key,65),10000,2,500)
 process=loader.k.OpenProcess(0x43a,False,pid)
 if not process:raise OSError('PROCESS_UNAVAILABLE')
 state={'pid':pid,'port':a.port,'token':token,'wxid':wxid,'scope':'own-moments','accountDirectory':account,'dllSha256':a.approved_sha256,'dllPath':str(dll),'loaded':False,'healthVerified':False,'maxReads':10000,'allowComment':True,'maxComments':500,'signingKey':signing_key,'approvedForApp':False,'validated':False}
 try:
  session_file.write_text(json.dumps(state,indent=2),encoding='utf-8');session_file.chmod(0o600)
  address=loader.allocate(process,(str(dll.resolve())+'\0').encode('utf-16le'));loader.call(process,loader.remote_export(pid,'LoadLibraryW'),address);loader.k.VirtualFreeEx(process,address,0,0x8000)
  loaded=[r for r in loader.modules(pid) if Path(r['path']).resolve()==dll.resolve()]
  if len(loaded)!=1:raise OSError('LOAD_RESULT_UNKNOWN_NO_RETRY')
  state['loaded']=True;session_file.write_text(json.dumps(state,indent=2),encoding='utf-8');address=loader.allocate(process,config);code=loader.call(process,loaded[0]['base']+exports['XiaoyuMomentsServiceStart'],address);loader.k.VirtualFreeEx(process,address,0,0x8000)
  if code:raise OSError('COMPONENT_START_REFUSED_'+str(code))
  for _ in range(10):
   try:
    h=health(a.port,token)
    if h.get('integration')=='XiaoyuMomentsService-1' and h.get('pid')==pid and h.get('verified') is True and h.get('offlineTest') is False and h.get('maxReads')==10000 and h.get('maxComments')==500 and h.get('allowComment') is True and h.get('scope')=='own-moments':state['healthVerified']=True;break
   except (OSError,ValueError):pass
   time.sleep(.2)
  if not state['healthVerified']:raise OSError('HEALTH_UNKNOWN_NO_QUERY_OR_RETRY')
 finally:
  loader.k.CloseHandle(process);session_file.write_text(json.dumps(state,indent=2),encoding='utf-8');session_file.chmod(0o600)
 print(json.dumps({k:state[k] for k in ['pid','loaded','healthVerified','scope','maxReads','allowComment','dllSha256']}))
if __name__=='__main__':main()
