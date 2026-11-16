"""Load the read-only comment capture hook into the current WeChat process."""
import hashlib, importlib.util, json, socket, sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
DLL=ROOT/'data/wechat-moments-research/build/XiaoyuCommentHook.dll'
SESSION=ROOT/'data/wechat-native-research/session.json'

def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def read(p):return json.loads(Path(p).read_text(encoding='utf-8-sig'))

spec=importlib.util.spec_from_file_location('loader',ROOT/'scripts/load-wechat-native.py')
loader=importlib.util.module_from_spec(spec);spec.loader.exec_module(loader)
session=read(SESSION);pid=session['pid']
rows=loader.modules(pid)
if any(Path(x['path']).name.lower()=='xiaoyucommenthook.dll' for x in rows):
    raise SystemExit('hook already loaded; stop WeChat or use Hits only')
exports=loader.export_rvas(DLL,required={'XiaoyuCommentHookStart','XiaoyuCommentHookStop','XiaoyuCommentHookHits'})
process=loader.k.OpenProcess(0x43a,False,pid)
if not process:raise SystemExit('OpenProcess denied')
try:
    path=loader.allocate(process,(str(DLL)+'\0').encode('utf-16le'))
    loader.call(process,loader.remote_export(pid,'LoadLibraryW'),path)
    loader.k.VirtualFreeEx(process,path,0,0x8000)
    found=[x for x in loader.modules(pid) if Path(x['path']).resolve()==DLL.resolve()]
    if len(found)!=1:raise SystemExit('module loading not confirmed; do not retry')
    base=found[0]['base']
    ret=loader.call(process,base+exports['XiaoyuCommentHookStart'])
    hits=loader.call(process,base+exports['XiaoyuCommentHookHits'])
    print(json.dumps({'pid':pid,'base':hex(base),'start':ret,'hits':hits,'dllSha256':sha(DLL)}))
finally:
    loader.k.CloseHandle(process)
