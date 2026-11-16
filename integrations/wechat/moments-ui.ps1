param([Alias('Pid')][int]$TargetPid,[string]$Request,[string]$Out)
$ErrorActionPreference='Stop'
trap {
 try{ $dir=Split-Path -Parent $Out; if($dir){ [IO.File]::WriteAllText((Join-Path $dir 'moments-trap.txt'), ([string]$_.Exception.Message+"`n"+[string]$_.ScriptStackTrace), (New-Object System.Text.UTF8Encoding($false))) } }catch{}
 exit 1
}
Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms,System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class W {
 public delegate bool EnumProc(IntPtr h, IntPtr l);
 [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
 [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);
 [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr h, uint f);
 [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
 [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
 [DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y);
 [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
 [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
 [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
 [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
 [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a,uint b,bool f);
 [DllImport("user32.dll")] public static extern IntPtr SetFocus(IntPtr h);
 [DllImport("user32.dll")] public static extern void keybd_event(byte b,byte s,uint f,UIntPtr e);
 public static void ForceForeground(IntPtr h){ ShowWindow(h,9); uint p; uint fg=GetWindowThreadProcessId(GetForegroundWindow(),out p); uint me=GetCurrentThreadId(); keybd_event(0x12,0,0,UIntPtr.Zero); keybd_event(0x12,0,2,UIntPtr.Zero); if(fg!=me){AttachThreadInput(me,fg,true);} BringWindowToTop(h); SetForegroundWindow(h); SetFocus(h); if(fg!=me){AttachThreadInput(me,fg,false);} }
 [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern bool SetWindowText(IntPtr h, string t);
 [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, System.Text.StringBuilder s, int n);
 [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h, System.Text.StringBuilder s, int n);
 [DllImport("user32.dll")] public static extern void mouse_event(uint f,uint x,uint y,uint d,UIntPtr e);
 public struct RECT{public int L,T,R,B;}
 static bool IsMain(IntPtr h){ var s=new System.Text.StringBuilder(256); GetClassName(h,s,256); var c=s.ToString(); return c=="mmui::MainWindow"||c=="Qt51514QWindowIcon"; }
 public static IntPtr Find(uint pid){ IntPtr best=IntPtr.Zero; int area=0; EnumWindows((h,l)=>{uint p;GetWindowThreadProcessId(h,out p);if(p==pid&&IsWindowVisible(h)){var s=new System.Text.StringBuilder(256);GetClassName(h,s,256);if(s.ToString()=="Qt51514QWindowIcon"){RECT r;GetWindowRect(h,out r);int a=(r.R-r.L)*(r.B-r.T);if(a>area){area=a;best=h;}}}return true;},IntPtr.Zero); if(best==IntPtr.Zero){EnumWindows((h,l)=>{uint p;GetWindowThreadProcessId(h,out p);if(p==pid&&IsWindowVisible(h)&&IsMain(h)){RECT r;GetWindowRect(h,out r);int a=(r.R-r.L)*(r.B-r.T);if(a>area){area=a;best=h;}}return true;},IntPtr.Zero);} return best; }
 public static uint FindMainPid(){uint bestPid=0;int area=0;EnumWindows((h,l)=>{uint p;GetWindowThreadProcessId(h,out p);if(IsWindowVisible(h)&&IsMain(h)){RECT r;GetWindowRect(h,out r);int a=(r.R-r.L)*(r.B-r.T);if(a>area){area=a;bestPid=p;}}return true;},IntPtr.Zero);return bestPid;}
 public static IntPtr FindAny(uint pid){ IntPtr best=IntPtr.Zero; int area=0; EnumWindows((h,l)=>{uint p;GetWindowThreadProcessId(h,out p);if(p==pid){RECT r;GetWindowRect(h,out r);int a=(r.R-r.L)*(r.B-r.T);if(a>area){area=a;best=h;}}return true;},IntPtr.Zero);return best;}
 public static void HideTray(uint pid){EnumWindows((h,l)=>{uint p;GetWindowThreadProcessId(h,out p);if(p==pid){var s=new System.Text.StringBuilder(256);GetClassName(h,s,256);if(s.ToString().IndexOf("TrayIcon",StringComparison.OrdinalIgnoreCase)>=0){ShowWindow(h,0);}}return true;},IntPtr.Zero);}
 public static void Click(int x,int y){ SetCursorPos(x,y); mouse_event(2,0,0,0,UIntPtr.Zero); mouse_event(4,0,0,0,UIntPtr.Zero); }
 public static void RightClick(int x,int y){ SetCursorPos(x,y); mouse_event(8,0,0,0,UIntPtr.Zero); mouse_event(16,0,0,0,UIntPtr.Zero); }
}
'@
$utf8=New-Object System.Text.UTF8Encoding($false)
$req=Get-Content -LiteralPath $Request -Raw -Encoding UTF8 | ConvertFrom-Json
$text=[string]$req.text
$media=@($req.media | Where-Object { $_ })
$privacy=[string]$req.privacy
$dryRun=($req.dryRun -eq $true)
$publish=[bool]$req.publish
$action=[string]$req.action
$comment=$req.comment
$selfName=[string]$req.selfName
$result=[ordered]@{ok=$false;stage='init';published=$false;submissionAttempted=$false;canceled=$false;replied=$false;textSet=$false;mediaCount=$media.Count;privacy=$privacy;notes=@()}
$createdCompose=$false
function Save(){ [IO.File]::WriteAllText($Out,($result|ConvertTo-Json -Depth 5 -Compress),$utf8) }
function I([double]$v){ if([double]::IsNaN($v) -or [double]::IsInfinity($v)){return 0}; return [int]$v }
$hwnd=[W]::Find([uint32]$TargetPid)
$result.targetPid=$TargetPid
if($hwnd -eq [IntPtr]::Zero){ $hwnd=[W]::FindAny([uint32]$TargetPid); if($hwnd -ne [IntPtr]::Zero){ [void][W]::ShowWindow($hwnd,9); Start-Sleep -Milliseconds 800 } }
if($hwnd -eq [IntPtr]::Zero){ $result.error='no-window'; Save; exit 0 }
$result.hwnd=[string]$hwnd
$root=[System.Windows.Automation.AutomationElement]::FromHandle($hwnd)
[W]::ForceForeground($hwnd)
Start-Sleep -Milliseconds 800
[void][W]::HideTray([uint32]$TargetPid)
Start-Sleep -Milliseconds 1800
$hwnd=[W]::Find([uint32]$TargetPid)
if($hwnd -ne [IntPtr]::Zero){ $root=[System.Windows.Automation.AutomationElement]::FromHandle($hwnd) }
[void][W]::HideTray([uint32]$TargetPid)
function ByName([string]$name){
 $list=@()
 $sources=@($root,[System.Windows.Automation.AutomationElement]::RootElement)
 $nameCond=New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty,$name)
 $pidCond=New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty,[int]$TargetPid)
 $cond=New-Object System.Windows.Automation.AndCondition -ArgumentList @($pidCond,$nameCond)
 foreach($src in $sources){
  try{
   $all=$src.FindAll([System.Windows.Automation.TreeScope]::Descendants,$cond)
   for($i=0;$i -lt $all.Count;$i++){ try{ $e=$all.Item($i); if($e.Current.Name -eq $name -and -not $e.Current.IsOffscreen){ $r=$e.Current.BoundingRectangle; $a=(I $r.Width)*(I $r.Height); if($a -gt 0){ $list += [pscustomobject]@{e=$e;area=$a} } } }catch{ continue } }
  }catch{ continue }
 }
 return @($list | Group-Object {($_.e.GetRuntimeId() -join ':')} | ForEach-Object {$_.Group[0]} | Sort-Object area -Descending)
}
function ClickEl($e){ $r=$e.Current.BoundingRectangle; if((I $r.Width) -le 0){throw 'no-click'}; [W]::Click((I ($r.X+$r.Width/2)),(I ($r.Y+$r.Height/2))) }
function SnsList(){ $l=$root.FindFirst([System.Windows.Automation.TreeScope]::Descendants,(New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::AutomationIdProperty,'sns_list'))); if($l -ne $null){return $l}; try{ $l=$root.FindFirst([System.Windows.Automation.TreeScope]::Descendants,(New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ClassNameProperty,'mmui::TimeLineListView'))); if($l -ne $null){return $l} }catch{}; try{ $all=$root.FindAll([System.Windows.Automation.TreeScope]::Descendants,(New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty,[System.Windows.Automation.ControlType]::List))); for($i=0;$i -lt $all.Count;$i++){ $e=$all.Item($i); if(([string]$e.Current.Name) -match '朋友圈'){return $e} } }catch{}; return $null }
function FindEdit(){
 $best=$null; $bottom=-1
 $edits=[System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Descendants,(New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty,[System.Windows.Automation.ControlType]::Edit)))
 for($i=0;$i -lt $edits.Count;$i++){ try{ $e=$edits.Item($i); $r=$e.Current.BoundingRectangle; if(-not $e.Current.IsOffscreen -and (I $r.Width) -gt 150 -and (I $r.Height) -gt 40 -and (I $r.Bottom) -gt $bottom){$bottom=(I $r.Bottom);$best=$e} }catch{} }
 return $best
}
function ItemNames($it){
 $names=@()
 try{ if($it.Current.Name){$names += [string]$it.Current.Name} }catch{ return @() }
 try{
  $desc=$it.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition)
  for($j=0;$j -lt $desc.Count;$j++){ try{ $e=$desc.Item($j); $n=[string]$e.Current.Name; if($n -and -not $e.Current.IsOffscreen -and $names -notcontains $n){$names += $n} }catch{ continue } }
 }catch{}
 return @($names)
}
function ListRows(){ $list=SnsList; if($list -eq $null){return @()}; try{ return @($list.FindAll([System.Windows.Automation.TreeScope]::Descendants,(New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty,[System.Windows.Automation.ControlType]::ListItem)))) }catch{ return @() } }
function OwnRows(){
 $list=SnsList; if($list -eq $null){return @()}
 try{ $rows=@($list.FindAll([System.Windows.Automation.TreeScope]::Descendants,(New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty,[System.Windows.Automation.ControlType]::ListItem)))) }catch{ return @() }
 $own=@()
 for($i=0;$i -lt $rows.Count;$i++){
  try{ $it=$rows[$i]; $isOwn=((ItemNames $it) -contains '删除')
   if(-not $isOwn -and $selfName){ try{ if(([string]$it.Current.Name).StartsWith($selfName+' ')){ $isOwn=$true } }catch{} }
   if(-not $isOwn){ try{ $desc=$it.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition); for($j=0;$j -lt $desc.Count;$j++){ if([string]$desc.Item($j).Current.Name -eq '删除'){ $isOwn=$true; break } } }catch{} }
   if($isOwn){ $own += $it }
  }catch{ continue }
 }
 return $own
}
function FindPostItem([string]$needle){
 $rows=OwnRows; $key=($needle -replace '\s+',' ').Trim(); if(-not $key){return $null}
 for($i=0;$i -lt $rows.Count;$i++){ $names=(ItemNames $rows[$i]) -join ' '; if($names -replace '\s+',' ' -like ('*'+$key.Substring(0,[Math]::Min(18,$key.Length))+'*')){return $rows[$i]} }
 return $null
}
function TopWindows(){
 $cond=New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty,[int]$TargetPid)
 $all=[System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children,$cond)
 $out=@(); for($i=0;$i -lt $all.Count;$i++){ $w=$all.Item($i); try{ if(-not $w.Current.IsOffscreen){ $out += $w } }catch{} }
 return @($out)
}
function WindowKey($w){ try{ return [string]([IntPtr]$w.Current.NativeWindowHandle) }catch{ return '' } }
function WindowTexts($w){
 $names=@(); try{ if($w.Current.Name){$names += [string]$w.Current.Name} }catch{}
 $all=$w.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition)
 for($i=0;$i -lt $all.Count;$i++){ try{ $e=$all.Item($i); $n=[string]$e.Current.Name; if($n -and -not $e.Current.IsOffscreen -and $names -notcontains $n){$names += $n}
  if($names.Count -ge 120){break} }catch{}
 }
 return @($names)
}
function SetValue($edit,[string]$value){
 $vp=$null; if($edit.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern,[ref]$vp)){ $vp.SetValue($value); Start-Sleep -Milliseconds 300; return $true }
 try{ $edit.SetFocus(); Start-Sleep -Milliseconds 150; [System.Windows.Forms.SendKeys]::SendWait('^a'); [System.Windows.Forms.SendKeys]::SendWait($value) }catch{ return $false }
 return $true
}
function Panel(){ return $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants,(New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::AutomationIdProperty,'SnsPublishPanel'))) }
function Dialog(){ $c=New-Object System.Windows.Automation.AndCondition((New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ClassNameProperty,'#32770')),(New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty,[int]$TargetPid))); return [System.Windows.Automation.AutomationElement]::RootElement.FindFirst([System.Windows.Automation.TreeScope]::Descendants,$c) }
function CancelCompose(){
 for($i=0;$i -lt 6;$i++){
  $fd=Dialog; if($fd -ne $null){ try{$fd.GetCurrentPattern([System.Windows.Automation.WindowPattern]::Pattern).Close(); Start-Sleep -Milliseconds 600}catch{}; continue }
  $d=ByName '不保留'; if($d.Count -gt 0){ ClickEl $d[0].e; Start-Sleep -Milliseconds 600; continue }
  $p=Panel; if($p -ne $null){ $c=$p.FindFirst([System.Windows.Automation.TreeScope]::Descendants,(New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty,'取消'))); if($c -ne $null){ ClickEl $c; Start-Sleep -Milliseconds 600; continue } }
  break
 }
}
function ClickMenu([string]$name){ $until=[DateTime]::UtcNow.AddSeconds(3);do{$m=ByName $name;if($m.Count -gt 0){ClickEl $m[0].e;return};Start-Sleep -Milliseconds 150}while([DateTime]::UtcNow -lt $until);throw ('menu-not-found:'+$name) }
function FileDialog(){
 $c=New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ClassNameProperty,'#32770')
 $all=[System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Descendants,$c)
 for($i=0;$i -lt $all.Count;$i++){
  $w=$all.Item($i)
  try{ if($w.Current.IsOffscreen -or $w.Current.ProcessId -ne $TargetPid){continue} }catch{continue}
  $open=$w.FindFirst([System.Windows.Automation.TreeScope]::Descendants,(New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty,'打开(O)')))
  if($open -eq $null){continue}
  $edits=$w.FindAll([System.Windows.Automation.TreeScope]::Descendants,(New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty,[System.Windows.Automation.ControlType]::Edit)))
  for($j=0;$j -lt $edits.Count;$j++){ $e=$edits.Item($j); $r=$e.Current.BoundingRectangle; if((I $r.Width) -gt 100 -and -not $e.Current.IsOffscreen){ return $w } }
 }
 return $null
}
function FileDialogOpen([string]$payload){
 $fd=$null; for($i=0;$i -lt 20;$i++){ $fd=FileDialog; if($fd -ne $null){break}; Start-Sleep -Milliseconds 200 }
 if($fd -eq $null){
  $tw=[System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children,[System.Windows.Automation.Condition]::TrueCondition)
  for($i=0;$i -lt $tw.Count;$i++){ $w=$tw.Item($i); if(-not $w.Current.IsOffscreen){ $result.notes += ('win|'+$w.Current.ClassName+'|'+$w.Current.Name+'|pid='+$w.Current.ProcessId) } }
  throw 'file-dialog-missing'
 }
 [W]::ForceForeground([IntPtr]$fd.Current.NativeWindowHandle)
 Start-Sleep -Milliseconds 500
 $edit=$null; $bestY=-1
 $edits=$fd.FindAll([System.Windows.Automation.TreeScope]::Descendants,(New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ClassNameProperty,'Edit')))
 for($j=0;$j -lt $edits.Count;$j++){ $cand=$edits.Item($j); $r=$cand.Current.BoundingRectangle; $chh=0; try{ $chh=[IntPtr]$cand.Current.NativeWindowHandle }catch{}; $result.notes += ('ed|'+$cand.Current.ClassName+'|'+$cand.Current.AutomationId+'|'+(I $r.X)+','+(I $r.Y)+','+(I $r.Width)+'x'+(I $r.Height)+'|off='+$cand.Current.IsOffscreen+'|h='+$chh); if((I $r.Width) -gt 100 -and -not $cand.Current.IsOffscreen -and (I $r.Y) -gt $bestY){ $bestY=(I $r.Y); $edit=$cand } }
 $set=$false; $vp=$null
 if($edit -ne $null){ try{ $edit.SetFocus(); Start-Sleep -Milliseconds 200 }catch{} }
 $result.notes += ('edit-found|'+($edit -ne $null))
 if($edit -ne $null){ $result.notes += ('edit-class|'+$edit.Current.ClassName+'|edit-aid|'+$edit.Current.AutomationId) }
 $eh=0; try{ $eh=[IntPtr]$edit.Current.NativeWindowHandle }catch{}
 $result.notes += ('edit-hwnd|'+$eh)
 if($eh -ne 0){
  $chain=@($edit)
  try{ $p1=[System.Windows.Automation.TreeWalker]::ControlViewWalker.GetParent($edit); if($p1 -ne $null){ $chain += $p1; $p2=[System.Windows.Automation.TreeWalker]::ControlViewWalker.GetParent($p1); if($p2 -ne $null){ $chain += $p2 } } }catch{}
  foreach($ce in $chain){ try{ $ch=[IntPtr]$ce.Current.NativeWindowHandle; if($ch -ne 0){ [void][W]::SetWindowText($ch,$payload); $result.notes += ('settext|'+$ce.Current.ClassName+'|'+$ch) } }catch{}; $now=''; try{ $nsb=New-Object System.Text.StringBuilder 1024; [void][W]::GetWindowText([IntPtr]$edit.Current.NativeWindowHandle,$nsb,1024); $now=$nsb.ToString() }catch{}; if($now -eq $payload){break} }
  Start-Sleep -Milliseconds 300
 }
 $wt=''; if($eh -ne 0){ try{ $wsb=New-Object System.Text.StringBuilder 1024; [void][W]::GetWindowText($eh,$wsb,1024); $wt=$wsb.ToString() }catch{} }
 $result.notes += ('hwnd-text|'+$wt)
 if($wt -eq $payload){ $set=$true }
 if($vp -eq $null -and $edit -ne $null){ try{ [void]$edit.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern,[ref]$vp) }catch{} }
 $before=''
 if($vp -ne $null){ try{ $before=[string]$vp.Current.Value }catch{} }
 $result.notes += ('value-before|'+$before)
 if($vp -ne $null){ try{ $vp.SetValue($payload); Start-Sleep -Milliseconds 300 }catch{ $result.notes += ('setvalue-error|'+$_.Exception.Message) } }
 $after1=''; if($vp -ne $null){ try{ $after1=[string]$vp.Current.Value }catch{} }
 $result.notes += ('value-after-set|'+$after1)
 if($after1 -eq $payload){$set=$true}
 $fdH=[IntPtr]$fd.Current.NativeWindowHandle
 if(-not $set){
  [W]::ForceForeground($fdH)
  Start-Sleep -Milliseconds 500
  try{ ClickEl $edit }catch{ try{ $edit.SetFocus() }catch{} }
  Start-Sleep -Milliseconds 400
  [System.Windows.Forms.SendKeys]::SendWait('^a'); Start-Sleep -Milliseconds 150
  [System.Windows.Forms.SendKeys]::SendWait($payload); Start-Sleep -Milliseconds 700
  $after2=''; if($eh -ne 0){ try{ $ksb=New-Object System.Text.StringBuilder 1024; [void][W]::GetWindowText($eh,$ksb,1024); $after2=$ksb.ToString() }catch{} }
  $result.notes += ('value-after-keys|'+$after2)
  if($after2 -eq $payload){$set=$true}
  [System.Windows.Forms.SendKeys]::SendWait('{ENTER}'); Start-Sleep -Milliseconds 900
  if(-not [W]::IsWindow($fdH)){ return }
 }
 if(-not $set){ $result.notes += ('path-unconfirmed|'+$payload); throw 'file-path-unconfirmed' }
 $open=$null
 $els=$fd.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition)
 for($k=0;$k -lt $els.Count;$k++){ $e=$els.Item($k); if($e.Current.Name -like '打开*'){ $open=$e; break } }
 if($open -eq $null){throw 'open-button-missing'}
 $fdH=[IntPtr]$fd.Current.NativeWindowHandle
 ClickEl $open
 for($i=0;$i -lt 60;$i++){ Start-Sleep -Milliseconds 150; if(-not [W]::IsWindow($fdH)){break} }
 if([W]::IsWindow($fdH)){
  $all=$fd.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition)
  for($i=0;$i -lt [Math]::Min($all.Count,30);$i++){ $e=$all.Item($i); $result.notes += (($e.Current.ControlType.ProgrammaticName)+'|'+$e.Current.ClassName+'|'+$e.Current.AutomationId+'|'+$e.Current.Name+'|off='+$e.Current.IsOffscreen) }
  throw 'file-dialog-stuck'
}
 Start-Sleep -Milliseconds 900
}
function ComposeSignature($p){$names=@();$all=$p.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition);for($i=0;$i -lt $all.Count -and $i -lt 400;$i++){try{if(-not $all[$i].Current.IsOffscreen){$value='';$pattern=$null;if($all[$i].TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern,[ref]$pattern)){$value=[string]$pattern.Current.Value};$names+=([string]$all[$i].Current.AutomationId+'|'+[string]$all[$i].Current.Name+'|'+$value)}}catch{}};$h=[Security.Cryptography.SHA256]::Create();try{return [BitConverter]::ToString($h.ComputeHash([Text.Encoding]::UTF8.GetBytes(($names -join "`n")))).Replace('-','').ToLowerInvariant()}finally{$h.Dispose()}}
function WaitButton([string]$name){$until=[DateTime]::UtcNow.AddSeconds(3);do{$b=@(ByName $name | Where-Object {$_.e.Current.IsEnabled});if($b.Count -gt 1){throw ('ambiguous-button:'+$name)};if($b.Count -eq 1){return $b[0].e};Start-Sleep -Milliseconds 150}while([DateTime]::UtcNow -lt $until);return $null}
try{
 if([string]$req.phase -eq 'commit'){
  $p=Panel;if($p -eq $null){throw 'prepared-panel-missing'}
  if((ComposeSignature $p) -ne [string]$req.composeSignature){throw 'prepared-content-changed'}
  $btn=$p.FindFirst([System.Windows.Automation.TreeScope]::Descendants,(New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty,'发表')))
  if($btn -eq $null -or -not $btn.Current.IsEnabled){throw 'publish-button-not-ready'}
  $result.stage='submitting';$result.submissionAttempted=$true;Save
  ClickEl $btn
  $result.stage='submitted';$result.ok=$true;Save;exit 0
 }
 if((Panel) -ne $null -or (Dialog) -ne $null){throw 'existing-draft-or-dialog'}
 $result.stage='navigate'
 if([bool]$req.inspect){
  $result.stage='inspect'
  try{
   $wc=New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty,[int]$TargetPid)
   $tw=[System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children,$wc); $diag=@()
   foreach($w in $tw){ try{ $wr=$w.Current.BoundingRectangle; $cnt=0; try{$cnt=$w.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition).Count}catch{}; $diag += ('win|'+[string]$w.Current.ClassName+'|'+[string]$w.Current.Name+'|'+(I $wr.X)+','+(I $wr.Y)+','+(I $wr.Width)+'x'+(I $wr.Height)+'|n='+$cnt+'|off='+[string]$w.Current.IsOffscreen) }catch{} }
   $result.diag=$diag
   $result.rootClass=''; try{$result.rootClass=[string]$root.Current.ClassName}catch{}
  }catch{}
  try{ $wl=SnsList; if($wl -ne $null -and $req.scroll){ $sp=$null; if($wl.TryGetCurrentPattern([System.Windows.Automation.ScrollPattern]::Pattern,[ref]$sp)){ if([int]$req.scroll -lt 0){ $sp.Scroll([System.Windows.Automation.ScrollAmount]::LargeIncrement,[System.Windows.Automation.ScrollAmount]::NoAmount) }else{ $sp.Scroll([System.Windows.Automation.ScrollAmount]::LargeDecrement,[System.Windows.Automation.ScrollAmount]::NoAmount) }; $result.notes += 'scroll-pattern'; Start-Sleep -Milliseconds 900 } } }catch{}
  try{ $wl=SnsList; if($wl -ne $null -and $req.key){ try{$wl.SetFocus()}catch{}; Start-Sleep -Milliseconds 200; [System.Windows.Forms.SendKeys]::SendWait([string]$req.key); Start-Sleep -Milliseconds 900 } }catch{}
  try{ $wl=SnsList; if($wl -ne $null -and $req.wheel){ $wr=$wl.Current.BoundingRectangle; [W]::SetCursorPos((I ($wr.X+$wr.Width/2)),(I ($wr.Y+$wr.Height/2))); Start-Sleep -Milliseconds 200; [W]::Wheel([int]$req.wheel); Start-Sleep -Milliseconds 900 } }catch{}
  $list=SnsList
  if($list -eq $null -or [string]$req.inspect -eq 'album'){
   [W]::ForceForeground($hwnd); Start-Sleep -Milliseconds 500
   $disc=ByName '发现'
   $result.notes += ('nav-disc|'+$disc.Count)
   if($disc.Count -gt 0){ ClickEl $disc[0].e; Start-Sleep -Milliseconds 700 }
   else { [W]::Click(471,388); Start-Sleep -Milliseconds 700 }
   $root=[System.Windows.Automation.AutomationElement]::FromHandle($hwnd)
   $mom=ByName '朋友圈'
   $result.notes += ('nav-mom|'+$mom.Count)
   if($mom.Count -gt 0){ ClickEl $mom[0].e; Start-Sleep -Milliseconds 900 }
   else { [W]::Click(531,230); Start-Sleep -Milliseconds 900 }
   $root=[System.Windows.Automation.AutomationElement]::FromHandle($hwnd)
   $list=SnsList
   $result.notes += ('nav-list|'+([bool]($list -ne $null)))
  }
  if($list -eq $null){
   try{ $result.names=@($root.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition) | ForEach-Object { $_.Current.Name } | Where-Object { $_ } | Select-Object -First 60) }catch{ $result.names=@('names-failed') }
   throw 'sns-list-missing'
  }
  if([string]$req.inspect -eq 'texts'){
   $tx=$list.FindAll([System.Windows.Automation.TreeScope]::Descendants,(New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty,[System.Windows.Automation.ControlType]::Text)))
   for($ti=0;$ti -lt $tx.Count -and $ti -lt 160;$ti++){ try{ $e=$tx.Item($ti); $r=$e.Current.BoundingRectangle; $n=[string]$e.Current.Name; if($n){ $result.notes += ('txt|'+$n+'|'+(I $r.X)+','+(I $r.Y)+','+(I $r.Width)+'x'+(I $r.Height)+'|off='+$e.Current.IsOffscreen) } }catch{} }
   $result.ok=$true;$result.stage='texts-read';Save;exit 0
  }
  if([string]$req.inspect -eq 'album'){
    $result.notes += 'album-branch'; [W]::ForceForeground($hwnd); Start-Sleep -Milliseconds 400
   $me=ByName 'Kingsley'
   if($me.Count -gt 0){ $result.notes += ('me|'+$me[0].e.Current.ClassName+'|'+$me[0].e.Current.BoundingRectangle); ClickEl $me[0].e } else { [W]::Click(1088,430) }
   Start-Sleep -Milliseconds 2200
   $list=$root.FindFirst([System.Windows.Automation.TreeScope]::Descendants,(New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::AutomationIdProperty,'sns_list')))
   if($list -eq $null){ $result.names=@($root.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition) | ForEach-Object { $_.Current.Name } | Where-Object { $_ } | Select-Object -First 60); throw 'album-list-missing' }
  }
   if([string]$req.inspect -eq 'tree'){
    $rowsT=@(ListRows)
    for($ti=0;$ti -lt $rowsT.Count -and $ti -lt 8;$ti++){
     $itT=$rowsT[$ti]; $rrT=$itT.Current.BoundingRectangle; $namesT=ItemNames $itT
     $result.notes += ('row|'+$ti+'|'+(I $rrT.X)+','+(I $rrT.Y)+','+(I $rrT.Width)+'x'+(I $rrT.Height)+'|'+([string]$itT.Current.Name)+'|names='+($namesT -join '/'))
     $descT=$itT.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition)
     $result.notes += ('desc|'+$ti+'|'+$descT.Count)
     for($tj=0;$tj -lt $descT.Count -and $tj -lt 60;$tj++){
      $eT=$descT.Item($tj); $rT=$eT.Current.BoundingRectangle; $vT=''
      try{ $vp=$eT.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern); $vT=[string]$vp.Current.Value }catch{}
      try{ $result.notes += ('n|'+$eT.Current.ControlType.ProgrammaticName+'|'+$eT.Current.ClassName+'|'+$eT.Current.AutomationId+'|'+([string]$eT.Current.Name)+'|st='+([string]$eT.Current.ItemStatus)+'|ht='+([string]$eT.Current.HelpText)+'|v='+$vT+'|'+(I $rT.X)+','+(I $rT.Y)+','+(I $rT.Width)+'x'+(I $rT.Height)) }catch{}
     }
    }
    $result.ok=$true;$result.stage='tree-read';Save;exit 0
   }
   if([string]$req.inspect -eq 'detail'){
    $rows0=@(OwnRows)
    if($rows0.Count -eq 0){ $all0=@(ListRows); $rows0=@($all0 | Where-Object { $_.Current.Name -and ([string]$_.Current.Name).Length -gt 8 } | Sort-Object { ([string]$_.Current.Name).Length } -Descending) }
    if($rows0.Count -eq 0){throw 'own-post-missing'}
    $ir=$rows0[0].Current.BoundingRectangle
    [W]::ForceForeground($hwnd); Start-Sleep -Milliseconds 400
    try{[W]::SetCursorPos(500,500); Start-Sleep -Milliseconds 200; [System.Windows.Forms.SendKeys]::SendWait('{ESC}'); Start-Sleep -Milliseconds 400}catch{}
    $commentRow=$null
    foreach($cr in @(ListRows)){ $cn=[string]$cr.Current.Name; if($cn -match '评论区'){ $commentRow=$cr; break } }
    $points=@()
    if($commentRow -ne $null){ $cr=$commentRow.Current.BoundingRectangle; $points += ,@((I ($cr.X+60)),(I ($cr.Y+32))) }
    $points += ,@((I ($ir.X+180)),(I ($ir.Y+70)))
    $points += ,@((I ($ir.X+180)),(I ($ir.Y+130)))
    $points += ,@((I ($ir.X+260)),(I ($ir.Y+95)))
    foreach($pt in $points){ [W]::Click($pt[0],$pt[1]); Start-Sleep -Milliseconds 1200; $tw0=TopWindows; $extra=@($tw0 | Where-Object { [string]$_.Current.ClassName -ne 'mmui::MainWindow' -and [string]$_.Current.ClassName -notlike '*ProfileUniquePop*' }); if($extra.Count -gt 0){break} }
    $wins=TopWindows
    $winOut=@()
    for($wi=0;$wi -lt $wins.Count;$wi++){
     $w=$wins[$wi]; $wr=$w.Current.BoundingRectangle
     $winOut += [ordered]@{handle=[string]([IntPtr]$w.Current.NativeWindowHandle);class=[string]$w.Current.ClassName;name=[string]$w.Current.Name;rect=((I $wr.X).ToString()+','+(I $wr.Y).ToString()+','+(I $wr.Width).ToString()+'x'+(I $wr.Height).ToString());texts=@(WindowTexts $w)}
    }
    $result.windows=@($winOut); $result.ok=$true; $result.stage='detail-read'; Save; exit 0
   }
   $result.notes += 'inspect'
    try{
     $txAll=$root.FindAll([System.Windows.Automation.TreeScope]::Descendants,(New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty,[System.Windows.Automation.ControlType]::Text)))
     for($ti=0;$ti -lt $txAll.Count -and $ti -lt 200;$ti++){ try{ $e=$txAll.Item($ti); $r=$e.Current.BoundingRectangle; $n=[string]$e.Current.Name; if($n){ $result.notes += ('tx|'+$n+'|'+(I $r.X)+','+(I $r.Y)+','+(I $r.Width)+'x'+(I $r.Height)) } }catch{} }
    }catch{}
    $items=@()
    $allRows=@(ListRows)
    for($ri=0;$ri -lt $allRows.Count -and $ri -lt 12;$ri++){ $r0=$allRows[$ri]; $n0=(ItemNames $r0); $rr=$r0.Current.BoundingRectangle; $result.notes += ('row|'+$ri+'|'+(I $rr.X)+','+(I $rr.Y)+','+(I $rr.Width)+'x'+(I $rr.Height)+'|'+($n0 -join '/')) }
    $rows=@(OwnRows)
    if($rows.Count -eq 0){ $rows=@($allRows | Where-Object { $_.Current.Name -and ([string]$_.Current.Name).Length -gt 8 } | Sort-Object { ([string]$_.Current.Name).Length } -Descending) }
    for($i=0;$i -lt $rows.Count -and $i -lt 4;$i++){
     $it=$rows[$i]; $names=ItemNames $it
     $result.notes += ('feed|'+$i+'|'+$names.Count)
     $items += [ordered]@{name=[string]$it.Current.Name;texts=@($names)}
    }
    $result.items=@($items);$result.ok=$true;$result.stage='comments-read';Save;exit 0
  }
  if($action -eq 'comments' -or $action -eq 'reply'){
  $postText=[string]$comment.postText
  $item=FindPostItem $postText
  if($item -eq $null){ $item=FindPostItem ([string]$comment.content) }
  if($item -eq $null){throw 'post-not-found'}
  [W]::ForceForeground($hwnd); Start-Sleep -Milliseconds 400
  $target=$null
  $hits=@(ByName ([string]$comment.content) | Where-Object { $_.e.Current.ControlType.ProgrammaticName -eq 'ControlType.Text' })
  if($hits.Count -gt 0){ $target=$hits[0].e }
  $edit=$null
  if($target -ne $null){
   ClickEl $target; Start-Sleep -Milliseconds 900; $edit=FindEdit
   $result.notes += 'open-by-text'
  }
  if($edit -eq $null){
   $ir=$item.Current.BoundingRectangle
   $my=-1
   $imgs=$item.FindAll([System.Windows.Automation.TreeScope]::Descendants,(New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty,[System.Windows.Automation.ControlType]::Image)))
   for($ti=0;$ti -lt $imgs.Count;$ti++){ try{ $e2=$imgs.Item($ti); if($e2.Current.IsOffscreen){continue}; $r2=$e2.Current.BoundingRectangle; $b2=(I ($r2.Y+$r2.Height)); if($b2 -gt $my){ $my=$b2 } }catch{} }
   if($my -lt 0){ $my=(I ($ir.Y+180)) }
   $pts=@(@(($ir.Right-42),($ir.Bottom-20)),@(($ir.Right-42),($ir.Bottom-40)),@(($ir.Right-72),($ir.Bottom-20)),@(($ir.Right-24),($ir.Bottom-24)))
   foreach($pt in $pts){
    $mx=(I $pt[0]); $my=(I $pt[1])
    $result.notes += ('open-by-more|'+$mx+'|'+$my)
    [W]::Click($mx,$my); Start-Sleep -Milliseconds 800
    $cbtn=@(ByName '评论' | Where-Object { -not $_.e.Current.IsOffscreen })
    if($cbtn.Count -eq 0){ $cbtn=@(ByName '写评论') }
    if($cbtn.Count -gt 0){ ClickEl $cbtn[0].e; Start-Sleep -Milliseconds 1000; $edit=FindEdit; if($edit -ne $null){break} }
   }
  }
  $result.stage='reply-comment'
  if($edit -eq $null){
   $fresh=@(OwnRows); $scan=$item; if($fresh.Count -gt 0){$scan=$fresh[0]}
   $desc=$scan.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition)
   $result.notes += ('scan-count|'+$desc.Count+'|fresh|'+$fresh.Count)
   for($j=0;$j -lt $desc.Count -and $j -lt 160;$j++){ $e=$desc.Item($j); $r=$e.Current.BoundingRectangle; $result.notes += ('n|'+$e.Current.ControlType.ProgrammaticName+'|'+$e.Current.ClassName+'|'+$e.Current.AutomationId+'|'+([string]$e.Current.Name)+'|'+(I $r.X)+','+(I $r.Y)+','+(I $r.Width)+'x'+(I $r.Height)+'|off='+$e.Current.IsOffscreen) }
   throw ('comment-editor-missing|'+($result.notes -join ';'))
  }
  $result.editorFound=$true
  if($dryRun){
   [void](SetValue $edit '预览回复'); Start-Sleep -Milliseconds 500
   $bl=@(); $btns=$root.FindAll([System.Windows.Automation.TreeScope]::Descendants,(New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty,[System.Windows.Automation.ControlType]::Button)))
   for($q=0;$q -lt $btns.Count;$q++){ try{ $bn=[string]$btns.Item($q).Current.Name; if($bn -and -not $btns.Item($q).Current.IsOffscreen){$bl += $bn} }catch{} }
   $result.notes += ('reply-buttons|'+($bl -join ','))
   [void](SetValue $edit '')
   $result.dryRun=$true;$result.ok=$true;$result.stage='reply-dry-run';try{$edit.SetFocus();Start-Sleep -Milliseconds 150;[System.Windows.Forms.SendKeys]::SendWait('{ESC}')}catch{};Save;exit 0
  }
  if($edit -eq $null){throw ('comment-editor-missing|'+($result.notes -join ';'))}
  if(-not (SetValue $edit $text)){throw 'comment-write-failed'}
  $result.textSet=$true
  Start-Sleep -Milliseconds 400
  $send=@()
  $send=ByName '发送'
  if($send.Count -eq 0){$send=ByName '评论'}
   $er=$edit.Current.BoundingRectangle
   $result.notes += ('edit-rect|'+(I $er.X)+'|'+(I $er.Y)+'|'+(I $er.Width)+'|'+(I $er.Height))
   if($send.Count -gt 0){ ClickEl $send[0].e }else{ [W]::Click((I ($er.Right+60)),(I ($er.Bottom-18))) }
  Start-Sleep -Milliseconds 1800
  $result.replied=$false;$result.ok=$true;$result.stage='unknown';$result.notes+="UI text is not a verified delivery receipt";Save;exit 0
 }
  $disc=ByName '发现'; for($i=0;$i -lt 20 -and $disc.Count -eq 0;$i++){ Start-Sleep -Milliseconds 500; [void][W]::SetForegroundWindow($hwnd); $disc=ByName '发现' }
 if($disc.Count -eq 0){throw 'discover-missing'}; ClickEl $disc[0].e; Start-Sleep -Milliseconds 700
 $mom=ByName '朋友圈'; if($mom.Count -eq 0){throw 'moments-missing'}; ClickEl $mom[0].e; Start-Sleep -Milliseconds 900
 $pubList=@(ByName '发表' | Where-Object { $_.e.Current.ClassName -eq 'mmui::XTabBarItem' })
 if($pubList.Count -eq 0){throw 'toolbar-publish-missing'}
 $r=$pubList[0].e.Current.BoundingRectangle; [W]::RightClick((I ($r.X+$r.Width/2)),(I ($r.Y+$r.Height/2))); Start-Sleep -Milliseconds 650
 if($media.Count -gt 0){
  $result.stage='media'; ClickMenu '选照片或视频';$createdCompose=$true
  $payload=($media | ForEach-Object { '"'+($_ -replace '/','\')+'"' }) -join ' '
  FileDialogOpen $payload
 }else{
  $result.stage='text'; ClickMenu '发表文字';$createdCompose=$true
 }
 Start-Sleep -Milliseconds 500
 $panel=Panel; if($panel -eq $null){throw 'compose-panel-missing'}
 $createdCompose=$true
 $edit=$panel.FindFirst([System.Windows.Automation.TreeScope]::Descendants,(New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty,[System.Windows.Automation.ControlType]::Edit)))
 if($edit -eq $null){throw 'editor-missing'}
 $vp=$null; if(-not $edit.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern,[ref]$vp)){throw 'editor-value-pattern-missing'}
 $vp.SetValue($text); $result.textSet=$true; Start-Sleep -Milliseconds 300
 if([string]$vp.Current.Value -ne $text){throw 'editor-text-mismatch'}
 if($privacy -eq 'private' -or $privacy -eq 'public'){
  $result.stage='privacy'
  $pv=ByName '谁可以看   '; if($pv.Count -eq 0){$pv=ByName '谁可以看'}
  if($pv.Count -eq 0){throw 'privacy-missing'}
  ClickEl $pv[0].e; Start-Sleep -Milliseconds 600
  $label=if($privacy -eq 'private'){'私密'}else{'公开'}
  $opt=@(ByName $label | Where-Object { $_.e.Current.ControlType.ProgrammaticName -eq 'ControlType.RadioButton' })
  if($opt.Count -eq 0){$opt=ByName $label}
  if($opt.Count -eq 0){throw ('privacy-option-missing:'+$label)}
  ClickEl $opt[0].e; Start-Sleep -Milliseconds 350
  $selection=$null; if($opt[0].e.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern,[ref]$selection)){if(-not $selection.Current.IsSelected){throw 'privacy-not-selected'}}else{throw 'privacy-selection-unverified'}
  $ok=WaitButton '确定'; if($ok -eq $null){throw 'privacy-confirm-missing'}
  ClickEl $ok; Start-Sleep -Milliseconds 300
 }
 if([string]$req.phase -eq 'prepare'){
  $panel=Panel;if($panel -eq $null){throw 'compose-panel-missing'}
  $previewCount=0;$imgs=$panel.FindAll([System.Windows.Automation.TreeScope]::Descendants,(New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty,[System.Windows.Automation.ControlType]::Image)));for($i=0;$i -lt $imgs.Count;$i++){try{$r=$imgs[$i].Current.BoundingRectangle;if(-not $imgs[$i].Current.IsOffscreen -and $r.Width -ge 48 -and $r.Height -ge 48){$previewCount++}}catch{}}
  if($previewCount -ne $media.Count){throw 'media-preview-not-ready'}
  $result.prepared=$true;$result.composeSignature=ComposeSignature $panel;$result.ok=$true;$result.stage='prepared';Save;exit 0
 }
 if($publish){
  throw 'prepare-commit-required'
 }else{
  $result.stage='cancel'
  CancelCompose
  $result.canceled=((Panel) -eq $null)
  $result.stage='canceled'
 }
 $result.ok=$true
}catch{
 $result.error=[string]($_.Exception.Message)
 $result.stage='error:'+$result.stage
 if($createdCompose -and -not $result.submissionAttempted){try{CancelCompose}catch{}}
}
Save
