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
 [DllImport("user32.dll")] static extern bool IsChild(IntPtr parent,IntPtr child);
 [StructLayout(LayoutKind.Sequential)] struct GUIINFO { public uint size,flags; public IntPtr active,focus,capture,menuOwner,moveSize,caret; public RECT rect; }
 [DllImport("user32.dll")] static extern bool GetGUIThreadInfo(uint thread,ref GUIINFO info);
 public static bool FilenameFocused(IntPtr edit){var g=new GUIINFO{size=(uint)Marshal.SizeOf(typeof(GUIINFO))};return edit!=IntPtr.Zero&&GetGUIThreadInfo(0,ref g)&&(g.focus==edit||IsChild(edit,g.focus));}
 [DllImport("user32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr SendMessageTimeout(IntPtr h,uint message,UIntPtr count,System.Text.StringBuilder text,uint flags,uint timeout,out UIntPtr result);
 public static string ReadEditText(IntPtr edit){var text=new System.Text.StringBuilder(32768);UIntPtr result;return SendMessageTimeout(edit,0x000D,(UIntPtr)text.Capacity,text,2,250,out result)==IntPtr.Zero?null:text.ToString();}
 [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
 [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a,uint b,bool f);
 [DllImport("user32.dll")] public static extern IntPtr SetFocus(IntPtr h);
 [DllImport("user32.dll")] public static extern void keybd_event(byte b,byte s,uint f,UIntPtr e);
 public static void ForceForeground(IntPtr h){ ShowWindow(h,9); uint p; uint fg=GetWindowThreadProcessId(GetForegroundWindow(),out p); uint me=GetCurrentThreadId(); keybd_event(0x12,0,0,UIntPtr.Zero); keybd_event(0x12,0,2,UIntPtr.Zero); if(fg!=me){AttachThreadInput(me,fg,true);} BringWindowToTop(h); SetForegroundWindow(h); SetFocus(h); if(fg!=me){AttachThreadInput(me,fg,false);} }
 [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern bool SetWindowText(IntPtr h, string t);
 [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, System.Text.StringBuilder s, int n);
 [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h, System.Text.StringBuilder s, int n);
 public static string NativeClass(IntPtr h){var s=new System.Text.StringBuilder(256);GetClassName(h,s,s.Capacity);return s.ToString();}
 [DllImport("user32.dll")] public static extern void mouse_event(uint f,uint x,uint y,uint d,UIntPtr e);
 public struct RECT{public int L,T,R,B;}
 static bool IsMain(IntPtr h){ var s=new System.Text.StringBuilder(256); GetClassName(h,s,256); var c=s.ToString(); return c=="mmui::MainWindow"||c=="Qt51514QWindowIcon"; }
 public static IntPtr Find(uint pid){ IntPtr best=IntPtr.Zero; int area=0; EnumWindows((h,l)=>{uint p;GetWindowThreadProcessId(h,out p);if(p==pid&&IsWindowVisible(h)){var s=new System.Text.StringBuilder(256);GetClassName(h,s,256);if(s.ToString()=="Qt51514QWindowIcon"){RECT r;GetWindowRect(h,out r);int a=(r.R-r.L)*(r.B-r.T);if(a>area){area=a;best=h;}}}return true;},IntPtr.Zero); if(best==IntPtr.Zero){EnumWindows((h,l)=>{uint p;GetWindowThreadProcessId(h,out p);if(p==pid&&IsWindowVisible(h)&&IsMain(h)){RECT r;GetWindowRect(h,out r);int a=(r.R-r.L)*(r.B-r.T);if(a>area){area=a;best=h;}}return true;},IntPtr.Zero);} return best; }
 public static uint FindMainPid(){uint bestPid=0;int area=0;EnumWindows((h,l)=>{uint p;GetWindowThreadProcessId(h,out p);if(IsWindowVisible(h)&&IsMain(h)){RECT r;GetWindowRect(h,out r);int a=(r.R-r.L)*(r.B-r.T);if(a>area){area=a;bestPid=p;}}return true;},IntPtr.Zero);return bestPid;}
 public static IntPtr FindAny(uint pid){ IntPtr best=IntPtr.Zero; int area=0; EnumWindows((h,l)=>{uint p;GetWindowThreadProcessId(h,out p);if(p==pid){RECT r;GetWindowRect(h,out r);int a=(r.R-r.L)*(r.B-r.T);if(a>area){area=a;best=h;}}return true;},IntPtr.Zero);return best;}
 public static void HideTray(uint pid){EnumWindows((h,l)=>{uint p;GetWindowThreadProcessId(h,out p);if(p==pid){var s=new System.Text.StringBuilder(256);GetClassName(h,s,256);if(s.ToString().IndexOf("TrayIcon",StringComparison.OrdinalIgnoreCase)>=0){ShowWindow(h,0);}}return true;},IntPtr.Zero);}
 public static void Click(int x,int y){ SetCursorPos(x,y); mouse_event(2,0,0,0,UIntPtr.Zero); mouse_event(4,0,0,0,UIntPtr.Zero); }
 public static void RightClick(int x,int y){ SetCursorPos(x,y); mouse_event(8,0,0,0,UIntPtr.Zero); mouse_event(16,0,0,0,UIntPtr.Zero); }
 [StructLayout(LayoutKind.Sequential)] public struct KEYINPUT { public ushort vk,scan; public uint flags,time; public UIntPtr extra; }
 [StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT { public int x,y; public uint data,flags,time; public UIntPtr extra; }
 [StructLayout(LayoutKind.Explicit)] public struct INPUTDATA { [FieldOffset(0)] public KEYINPUT key; [FieldOffset(0)] public MOUSEINPUT mouse; }
 [StructLayout(LayoutKind.Sequential)] public struct INPUT { public uint type; public INPUTDATA data; }
 [DllImport("user32.dll",SetLastError=true)] static extern uint SendInput(uint count,INPUT[] input,int size);
 public static INPUT[] UnicodeInputs(string text){var rows=new INPUT[text.Length*2];for(int i=0;i<text.Length;i++){rows[i*2]=new INPUT{type=1,data=new INPUTDATA{key=new KEYINPUT{scan=text[i],flags=4}}};rows[i*2+1]=new INPUT{type=1,data=new INPUTDATA{key=new KEYINPUT{scan=text[i],flags=6}}};}return rows;}
 public static void TypeUnicode(string text){var rows=UnicodeInputs(text);if(SendInput((uint)rows.Length,rows,Marshal.SizeOf(typeof(INPUT)))!=(uint)rows.Length)throw new InvalidOperationException("file-keyboard-input-incomplete");}
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
Save
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
 try{ $handle=[W]::Find([uint32]$TargetPid);if($handle -ne [IntPtr]::Zero){$script:root=[System.Windows.Automation.AutomationElement]::FromHandle($handle)} }catch{}
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
  # A visibility chooser can cover the editor and disable its Cancel button.
  # Escape only dismisses that owned, unsubmitted overlay; never presses Publish.
  if($i -eq 0){[System.Windows.Forms.SendKeys]::SendWait('{ESC}');Start-Sleep -Milliseconds 150}
  $fd=Dialog; if($fd -ne $null){ try{$fd.GetCurrentPattern([System.Windows.Automation.WindowPattern]::Pattern).Close(); Start-Sleep -Milliseconds 600}catch{}; continue }
  $d=ByName '不保留'; if($d.Count -gt 0){ ClickEl $d[0].e; Start-Sleep -Milliseconds 600; continue }
  $p=Panel; if($p -ne $null){ $c=$p.FindFirst([System.Windows.Automation.TreeScope]::Descendants,(New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty,'取消'))); if($c -ne $null){ ClickEl $c; Start-Sleep -Milliseconds 600; continue } }
  break
 }
}
function ClickMenu([string]$name){ $until=[DateTime]::UtcNow.AddSeconds(3);do{$m=ByName $name;if($m.Count -gt 0){ClickEl $m[0].e;return};Start-Sleep -Milliseconds 150}while([DateTime]::UtcNow -lt $until);throw ('menu-not-found:'+$name) }
function OpenPublishEntry([string]$name){
 for($attempt=0;$attempt -lt 2;$attempt++){
  $result.stage='publish-menu';$result.notes+=('menu-attempt:'+($attempt+1));Save
  $until=[DateTime]::UtcNow.AddSeconds(2);$items=@()
  do{$items=@(ByName '发表' | Where-Object {$_.e.Current.ClassName -eq 'mmui::XTabBarItem'});if($items.Count -gt 0){break};Start-Sleep -Milliseconds 150}while([DateTime]::UtcNow -lt $until)
  if($items.Count -eq 0){throw 'toolbar-publish-missing'}
  if($attempt -gt 0){[System.Windows.Forms.SendKeys]::SendWait('{ESC}');Start-Sleep -Milliseconds 150}
  $control=$items[0].e;$pattern=$null;$opened=$false
  if($attempt -gt 0 -and $control.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern,[ref]$pattern)){ $pattern.Invoke();$opened=$true }
  if(-not $opened){$bounds=$control.Current.BoundingRectangle;[W]::RightClick((I ($bounds.X+$bounds.Width/2)),(I ($bounds.Y+$bounds.Height/2)))}
  $until=[DateTime]::UtcNow.AddSeconds(2)
  do{$matches=@(ByName $name);if($matches.Count -gt 0){ClickEl $matches[0].e;return};Start-Sleep -Milliseconds 150}while([DateTime]::UtcNow -lt $until)
  $result.notes+=('expected-menu-count:'+(@(ByName $name).Count));Save
 }
 throw ('menu-not-found:'+$name)
}
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
function GetMomentMediaPreviewCount($panel){
 $cells=0;$hasGrid=$false;$images=0
 $all=$panel.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition)
 foreach($e in $all){try{
  $class=[string]$e.Current.ClassName
  if($class -in @('mmui::PublishImageGridCell','mmui::PublishImageAddGridCell')){$hasGrid=$true}
  $r=$e.Current.BoundingRectangle
  if($e.Current.IsOffscreen -or $r.Width -lt 48 -or $r.Height -lt 48){continue}
  if($class -eq 'mmui::PublishImageGridCell'){$cells++}
  elseif($e.Current.ControlType -eq [System.Windows.Automation.ControlType]::Image){$images++}
 }catch{}}
 # Qt exposes thumbnails as ListItems; the separate Add cell is not a picture.
 # Prefer the grid's image cells over nested image nodes to prevent double counts.
 if($hasGrid){return $cells};return $images
}
function GetMomentPrivacyRows($panel){
 $rows=$panel.FindAll([System.Windows.Automation.TreeScope]::Descendants,(New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ClassNameProperty,'mmui::PublishPrivacyView')))
 return @($rows | Where-Object {-not $_.Current.IsOffscreen -and [string]$_.Current.ClassName -eq 'mmui::PublishPrivacyView'})
}
function GetMomentPrivacySummary($panel){
 $rows=@(GetMomentPrivacyRows $panel);if($rows.Count -ne 1){return ''}
 $values=@(ItemNames $rows[0] | Where-Object {$_ -in @('公开','私密')} | Select-Object -Unique)
 if($values.Count -eq 1){return [string]$values[0]};return ''
}
function GetMomentPrivacyOptions([string]$label){
 # The editor's public/private summary has the same name as a real option.
 # Never treat that summary text as an actionable radio choice.
 return @(ByName $label | Where-Object {$_.e.Current.IsEnabled -and -not $_.e.Current.IsOffscreen -and ($_.e.Current.ControlType -eq [System.Windows.Automation.ControlType]::RadioButton -or [string]$_.e.Current.ClassName -eq 'mmui::PublishPrivacySelection')})
}
function GetMomentPublishButton($panel){
 $all=$panel.FindAll([System.Windows.Automation.TreeScope]::Descendants,(New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty,'发表')))
 $candidates=@($all | Where-Object {$_.Current.Name -eq '发表' -and $_.Current.IsEnabled -and -not $_.Current.IsOffscreen -and $_.Current.BoundingRectangle.Width -gt 0 -and $_.Current.BoundingRectangle.Height -gt 0})
 $buttons=@($candidates | Where-Object {$_.Current.ControlType -eq [System.Windows.Automation.ControlType]::Button})
 if($buttons.Count -gt 0){$candidates=$buttons}
 if($candidates.Count -ne 1){throw 'publish-button-not-ready'}
 return $candidates[0]
}
function ConvertToMomentFilePayload([string[]]$paths){
 if($paths.Count -lt 1 -or $paths.Count -gt 9){throw 'file-count-invalid'}
 $quoted=@();foreach($file in $paths){if([string]::IsNullOrWhiteSpace($file) -or $file.IndexOfAny([char[]]@([char]0,[char]10,[char]13,[char]34)) -ge 0){throw 'file-path-invalid'};$quoted+='"'+$file.Replace('/','\')+'"'}
 return ($quoted -join ' ')
}
function FileDialogOpen([string]$payload){
 $fd=$null;$until=[DateTime]::UtcNow.AddSeconds(3)
 do{$fd=FileDialog;if($fd -ne $null){break};Start-Sleep -Milliseconds 120}while([DateTime]::UtcNow -lt $until)
 if($fd -eq $null){throw 'file-dialog-missing'}
 $fdH=[IntPtr]$fd.Current.NativeWindowHandle
 [W]::ForceForeground($fdH);Start-Sleep -Milliseconds 150
 if([W]::GetForegroundWindow() -ne $fdH){throw 'file-dialog-focus-unconfirmed'}
 # Use the filename control, never a file-list rename edit or the address bar.
 $candidates=@();$edits=$fd.FindAll([System.Windows.Automation.TreeScope]::Descendants,(New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ClassNameProperty,'Edit')))
 for($j=0;$j -lt $edits.Count;$j++){
  $e=$edits.Item($j);$r=$e.Current.BoundingRectangle
  if($e.Current.IsOffscreen -or $r.Width -lt 100){continue}
  $parent=[System.Windows.Automation.TreeWalker]::ControlViewWalker.GetParent($e)
  if([string]$e.Current.AutomationId -eq '1148' -or ($parent -ne $null -and [string]$parent.Current.AutomationId -eq '1148')){$candidates+=$e}
 }
 if($candidates.Count -ne 1){throw 'file-name-control-unverified'}
 $edit=$candidates[0];$vp=$null;$set=$false
 if($edit.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern,[ref]$vp)){
  try{$vp.SetValue($payload);Start-Sleep -Milliseconds 100;$set=([string]$vp.Current.Value -eq $payload)}catch{}
 }
 if(-not $set){
  # WM_SETTEXT can change GetWindowText while the common dialog's own value stays
  # empty. Real Unicode input updates the shell's filename model and handles
  # Chinese, spaces, parentheses and SendKeys metacharacters without a clipboard.
  ClickEl $edit;try{$edit.SetFocus()}catch{$result.notes+='file-uia-focus-unavailable'};Start-Sleep -Milliseconds 100
  if([W]::GetForegroundWindow() -ne $fdH){throw 'file-dialog-focus-lost'}
  if(-not [W]::FilenameFocused([IntPtr]$edit.Current.NativeWindowHandle)){throw 'file-name-focus-unconfirmed'}
  [System.Windows.Forms.SendKeys]::SendWait('^a');[W]::TypeUnicode($payload)
  # GetWindowText does not retrieve another process's edit control contents.
  # Read the actual edit through bounded WM_GETTEXT, after input has settled.
  $value='';$until=[DateTime]::UtcNow.AddMilliseconds(1200)
  do{
   if($vp -ne $null){try{$value=[string]$vp.Current.Value}catch{}}
   if($value -ne $payload){$value=[W]::ReadEditText([IntPtr]$edit.Current.NativeWindowHandle)}
   $set=($value -eq $payload);if($set){break};Start-Sleep -Milliseconds 100
  }while([DateTime]::UtcNow -lt $until)
  $result.notes+='file-name-unicode-input';$result.notes+=('file-name-readback-length:'+([string]$value).Length+';expected:'+$payload.Length)
 }
 if(-not $set){throw 'file-path-unconfirmed'}
 $result.notes+='file-name-confirmed';Save
 $open=$null;$openCandidates=@()
 $all=$fd.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition)
 foreach($e in $all){
  try{if($e.Current.IsOffscreen -or -not $e.Current.IsEnabled){continue}
   $name=[string]$e.Current.Name;$type=$e.Current.ControlType
   $nativeDefault=([string]$e.Current.AutomationId -eq '1' -and [W]::NativeClass([IntPtr]$e.Current.NativeWindowHandle) -eq 'Button')
   if($name -in @('打开(O)','打开(&O)','打开','Open','Open(&O)') -and ($type -eq [System.Windows.Automation.ControlType]::Button -or $type -eq [System.Windows.Automation.ControlType]::SplitButton -or $nativeDefault)){$openCandidates+=$e}
  }catch{}
 }
 $result.notes+=('file-open-candidates:'+$openCandidates.Count)
 if($openCandidates.Count -ne 1){
  foreach($e in $all){try{if($e.Current.ControlType -eq [System.Windows.Automation.ControlType]::Button -or $e.Current.ControlType -eq [System.Windows.Automation.ControlType]::SplitButton -or ([string]$e.Current.Name).StartsWith('打开')){$result.notes+=('file-action:'+($e.Current.ControlType.ProgrammaticName)+'|'+[string]$e.Current.AutomationId+'|'+[string]$e.Current.Name+'|enabled='+$e.Current.IsEnabled+'|off='+$e.Current.IsOffscreen)}}catch{}}
  throw 'open-button-missing'
 }
 $open=$openCandidates[0]
 # Open imports media into the editor, it never publishes the moment.
 $invoke=$null;if($open.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern,[ref]$invoke)){$invoke.Invoke()}else{ClickEl $open}
 $until=[DateTime]::UtcNow.AddSeconds(4)
 do{if(-not [W]::IsWindow($fdH)){break};Start-Sleep -Milliseconds 100}while([DateTime]::UtcNow -lt $until)
 if([W]::IsWindow($fdH)){throw 'file-dialog-stuck'}
 $result.notes+='file-dialog-import-complete';Save
}
function ComposeSignature($p){$names=@();$all=$p.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition);for($i=0;$i -lt $all.Count -and $i -lt 400;$i++){try{if(-not $all[$i].Current.IsOffscreen){$value='';$pattern=$null;if($all[$i].TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern,[ref]$pattern)){$value=[string]$pattern.Current.Value};$names+=([string]$all[$i].Current.AutomationId+'|'+[string]$all[$i].Current.Name+'|'+$value)}}catch{}};$h=[Security.Cryptography.SHA256]::Create();try{return [BitConverter]::ToString($h.ComputeHash([Text.Encoding]::UTF8.GetBytes(($names -join "`n")))).Replace('-','').ToLowerInvariant()}finally{$h.Dispose()}}
function WaitButton([string]$name){$until=[DateTime]::UtcNow.AddSeconds(3);do{$b=@(ByName $name | Where-Object {$_.e.Current.IsEnabled});$buttons=@($b | Where-Object {$_.e.Current.ControlType -eq [System.Windows.Automation.ControlType]::Button});if($buttons.Count -gt 0){$b=$buttons};if($b.Count -gt 1){throw ('ambiguous-button:'+$name)};if($b.Count -eq 1){return $b[0].e};Start-Sleep -Milliseconds 150}while([DateTime]::UtcNow -lt $until);return $null}
try{
 if([string]$req.phase -eq 'commit'){
  $p=Panel;if($p -eq $null){throw 'prepared-panel-missing'}
  if((ComposeSignature $p) -ne [string]$req.composeSignature){throw 'prepared-content-changed'}
  $btn=GetMomentPublishButton $p
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
 if((Panel) -ne $null){throw 'compose-already-open:请先保存或关闭微信现有朋友圈编辑窗口'}
 $result.stage='discover';Save
  $disc=ByName '发现'; for($i=0;$i -lt 20 -and $disc.Count -eq 0;$i++){ Start-Sleep -Milliseconds 500; [void][W]::SetForegroundWindow($hwnd); $disc=ByName '发现' }
 if($disc.Count -eq 0){throw 'discover-missing'}; ClickEl $disc[0].e; Start-Sleep -Milliseconds 700
 $result.stage='timeline';Save
 $mom=ByName '朋友圈'; if($mom.Count -eq 0){throw 'moments-missing'}; ClickEl $mom[0].e; Start-Sleep -Milliseconds 900
 if($media.Count -gt 0){
  $result.stage='media';Save; OpenPublishEntry '选照片或视频';$createdCompose=$true
  $result.stage='media';Save
  $payload=ConvertToMomentFilePayload $media
  FileDialogOpen $payload
 }else{
  $result.stage='text';Save; OpenPublishEntry '发表文字';$createdCompose=$true
 }
 $result.stage='editor';Save
 $panel=$null;$until=[DateTime]::UtcNow.AddSeconds(2)
 do{$panel=Panel;if($panel -ne $null){break};Start-Sleep -Milliseconds 100}while([DateTime]::UtcNow -lt $until)
 if($panel -eq $null){throw 'compose-panel-missing'}
 $createdCompose=$true
 $edit=$panel.FindFirst([System.Windows.Automation.TreeScope]::Descendants,(New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty,[System.Windows.Automation.ControlType]::Edit)))
 if($edit -eq $null){throw 'editor-missing'}
 $vp=$null; if(-not $edit.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern,[ref]$vp)){throw 'editor-value-pattern-missing'}
 $vp.SetValue($text); $result.textSet=$true; Start-Sleep -Milliseconds 300
 if([string]$vp.Current.Value -ne $text){throw 'editor-text-mismatch'}
 if($privacy -eq 'private' -or $privacy -eq 'public'){
  $result.stage='privacy';Save
  $label=if($privacy -eq 'private'){'私密'}else{'公开'}
  $current=GetMomentPrivacySummary $panel
  $result.notes+=('privacy-initial-summary:'+$current)
  if($current -ne $label){
   $rows=@(GetMomentPrivacyRows $panel)
   if($rows.Count -ne 1){throw 'privacy-row-unverified'}
   ClickEl $rows[0]
   $opt=@();$until=[DateTime]::UtcNow.AddSeconds(2)
   do{$opt=@(GetMomentPrivacyOptions $label);if($opt.Count -gt 0){break};Start-Sleep -Milliseconds 100}while([DateTime]::UtcNow -lt $until)
   if($opt.Count -ne 1){throw 'privacy-option-not-ready'}
   $option=$opt[0].e;$selection=$null;$activated=$false
   if($option.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern,[ref]$selection)){
    try{$selection.Select();$activated=$selection.Current.IsSelected}catch{}
   }
   if(-not $activated){
    if($option.Current.IsKeyboardFocusable){
     try{$option.SetFocus();[System.Windows.Forms.SendKeys]::SendWait(' ');$activated=$true;$result.notes+='privacy-keyboard-action'}catch{}
    }
    if(-not $activated){ClickEl $option;$result.notes+='privacy-option-action'}
   }
   # Some Qt builds confirm the choice immediately; others keep an owned chooser.
   Start-Sleep -Milliseconds 150
   $stillOpen=@(GetMomentPrivacyOptions $label)
   if($stillOpen.Count -gt 0){
    $ok=WaitButton '确定';if($ok -eq $null){throw 'privacy-confirm-missing'}
    ClickEl $ok
   }
   $until=[DateTime]::UtcNow.AddSeconds(2)
   do{$panel=Panel;$current=if($panel -ne $null){GetMomentPrivacySummary $panel}else{''};$stillOpen=@(GetMomentPrivacyOptions $label);if($current -eq $label -and $stillOpen.Count -eq 0){break};Start-Sleep -Milliseconds 100}while([DateTime]::UtcNow -lt $until)
   if($stillOpen.Count -gt 0){throw 'privacy-chooser-still-open'}
  }else{$result.notes+='privacy-already-correct'}
  $result.notes+=('privacy-summary:'+$current)
  if($current -ne $label){throw 'privacy-summary-unverified'}
 }
 # The cancel-only rehearsal must validate the same media state as real prepare.
 if([string]$req.phase -eq 'prepare' -or -not $publish){
  $result.stage='verify-media';Save
  $panel=Panel;if($panel -eq $null){throw 'compose-panel-missing'}
  $previewCount=0;$until=[DateTime]::UtcNow.AddMilliseconds(1500)
  do{$previewCount=GetMomentMediaPreviewCount $panel;if($previewCount -eq $media.Count){break};Start-Sleep -Milliseconds 100}while([DateTime]::UtcNow -lt $until)
  $result.mediaPreviewCount=$previewCount;Save
  if($previewCount -ne $media.Count){
   $diagnostic=$panel.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition);$count=0
   foreach($e in $diagnostic){try{$r=$e.Current.BoundingRectangle;if(-not $e.Current.IsOffscreen -and $r.Width -ge 48 -and $r.Height -ge 48){$result.notes+=('media-control:'+($e.Current.ControlType.ProgrammaticName)+'|'+[string]$e.Current.ClassName+'|'+[string]$e.Current.AutomationId+'|'+(I $r.Width)+'x'+(I $r.Height));$count++;if($count -ge 20){break}}}catch{}}
   throw 'media-preview-not-ready'
  }
  $result.stage='verify-publish-button';Save
  $null=GetMomentPublishButton $panel
  $result.commitReady=$true;$result.prepared=$true
  if([string]$req.phase -eq 'prepare'){$result.composeSignature=ComposeSignature $panel;$result.ok=$true;$result.stage='prepared';Save;exit 0}
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
 if($createdCompose -and -not $result.submissionAttempted){try{CancelCompose;$result.canceled=((Panel) -eq $null)}catch{ $result.notes+='cleanup-unconfirmed' }}
}
Save
