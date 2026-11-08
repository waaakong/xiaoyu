// Independent foreground text sender. Uses Windows UI Automation only.
using System;
using System.Linq;
using System.Threading;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Collections.Generic;
using System.Windows.Automation;
using System.Windows.Forms;

public static class WhaleForeground {
  public static bool Attempted=false;
  static Random random=new Random();
  // Cache only stable identifier strings. Resolve a fresh UIA element for every
  // guard; never retain controls, titles, drafts, focus or target decisions.
  static Dictionary<string,string> resolvedIds=new Dictionary<string,string>(StringComparer.Ordinal);
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hwnd);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr hwnd);
  [DllImport("user32.dll")] static extern bool ShowWindowAsync(IntPtr hwnd,int command);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd,out uint processId);
  [DllImport("user32.dll",SetLastError=true)] static extern bool AttachThreadInput(uint from,uint to,bool attach);
  [StructLayout(LayoutKind.Sequential)] struct NativeMessage { public IntPtr Window; public uint Message; public UIntPtr WParam; public IntPtr LParam; public uint Time; public ScreenPoint Point; public uint Private; }
  [DllImport("user32.dll")] static extern bool PeekMessage(out NativeMessage message,IntPtr window,uint min,uint max,uint remove);
  [DllImport("user32.dll")] static extern short GetAsyncKeyState(int key);
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
  [StructLayout(LayoutKind.Sequential)] struct ScreenPoint { public int X; public int Y; }
  [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(ScreenPoint point);
  [DllImport("user32.dll")] static extern bool SetCursorPos(int x,int y);
  [DllImport("user32.dll")] static extern void mouse_event(uint flags,uint x,uint y,uint data,UIntPtr extra);
  static AutomationElement Find(AutomationElement root, string id) {
    string fullId;
    if(resolvedIds.TryGetValue(id,out fullId)){
      var fresh=root.FindFirst(TreeScope.Descendants,new PropertyCondition(AutomationElement.AutomationIdProperty,fullId));
      if(fresh!=null)return fresh;
      resolvedIds.Remove(id);
    }
    var exact=root.FindFirst(TreeScope.Descendants,new PropertyCondition(AutomationElement.AutomationIdProperty,id));
    if(exact!=null)return exact;
    var matches=root.FindAll(TreeScope.Descendants,Condition.TrueCondition).Cast<AutomationElement>()
      .Where(e=>e.Current.AutomationId.EndsWith("."+id,StringComparison.Ordinal)).Take(2).ToArray();
    if(matches.Length!=1)return null;
    resolvedIds[id]=matches[0].Current.AutomationId;
    return matches[0];
  }
  static IntPtr WindowHandle(string exe) {
    exe=System.IO.Path.GetFullPath(exe);
    var candidates=Process.GetProcessesByName(System.IO.Path.GetFileNameWithoutExtension(exe)).Where(p=>{try{return p.MainWindowHandle!=IntPtr.Zero&&String.Equals(p.MainModule.FileName,exe,StringComparison.OrdinalIgnoreCase);}catch{return false;}}).ToArray();
    if(candidates.Length!=1)throw new Exception("FOREGROUND_WINDOW_AMBIGUOUS");
    return candidates[0].MainWindowHandle;
  }
  static AutomationElement Window(string exe) { return AutomationElement.FromHandle(WindowHandle(exe)); }
  static bool Click(AutomationElement e) {
    object pattern;
    if(e.TryGetCurrentPattern(InvokePattern.Pattern,out pattern)){((InvokePattern)pattern).Invoke();return true;}
    if(e.TryGetCurrentPattern(SelectionItemPattern.Pattern,out pattern)){((SelectionItemPattern)pattern).Select();return true;}
    return ClickPhysical(e);
  }
  static bool ClickPhysical(AutomationElement e) {
    System.Windows.Point point;
    if(e.TryGetClickablePoint(out point)){
      uint owner;var hit=WindowFromPoint(new ScreenPoint {X=(int)point.X,Y=(int)point.Y});GetWindowThreadProcessId(hit,out owner);
      if(owner!=(uint)e.Current.ProcessId)return false;
      SetCursorPos((int)point.X,(int)point.Y);mouse_event(2,0,0,0,UIntPtr.Zero);mouse_event(4,0,0,0,UIntPtr.Zero);return true;
    }
    return false;
  }
  static void Fill(AutomationElement e,string text) {
    object value;
    if(!e.TryGetCurrentPattern(ValuePattern.Pattern,out value))throw new Exception("FOREGROUND_VALUE_UNAVAILABLE");
    ((ValuePattern)value).SetValue(text);
  }
  public class ProbeReport { public bool Ready; public bool Input; public bool Search; public int Controls; public string[] Ids; public string[] Classes; public long WindowHwnd; public long ProviderHwnd; public long ForegroundHwnd; public int Titles; public int TitleNameLength; public int InputNameLength; public bool ExpectedTitleMatches; public bool VisibleTitleMatches; public string[] TitleFormatCodes; public bool ExpectedUnformattedTitleMatches; public bool ExpectedTitleSubstring; }
  public static ProbeReport ProbeState(string exe,string expected=null,bool diagnostics=false) {
    var root=Window(exe);
    var input=Find(root,"chat_input_field");
    var search=root.FindFirst(TreeScope.Descendants,new AndCondition(new PropertyCondition(AutomationElement.NameProperty,"搜索"),new PropertyCondition(AutomationElement.ControlTypeProperty,ControlType.Edit)));
    object value;
    var report=new ProbeReport();report.Input=input!=null&&input.TryGetCurrentPattern(ValuePattern.Pattern,out value);report.Search=search!=null&&search.TryGetCurrentPattern(ValuePattern.Pattern,out value);report.Ready=report.Input||report.Search;
    if(!diagnostics)return report;
    var controls=root.FindAll(TreeScope.Descendants,Condition.TrueCondition).Cast<AutomationElement>().ToArray();report.Controls=controls.Length;
    report.WindowHwnd=WindowHandle(exe).ToInt64();report.ProviderHwnd=root.Current.NativeWindowHandle;report.ForegroundHwnd=GetForegroundWindow().ToInt64();
    report.Ids=controls.Select(e=>e.Current.AutomationId).Where(s=>!String.IsNullOrEmpty(s)).Distinct().Take(40).ToArray();
    report.Classes=controls.Select(e=>e.Current.ClassName).Where(s=>!String.IsNullOrEmpty(s)).Distinct().Take(20).ToArray();
    var titles=controls.Where(e=>e.Current.AutomationId=="current_chat_name_label"||e.Current.AutomationId.EndsWith(".current_chat_name_label",StringComparison.Ordinal)).ToArray();
    report.Titles=titles.Length;report.TitleNameLength=titles.Length==0?-1:titles[0].Current.Name.Length;report.InputNameLength=input==null?-1:input.Current.Name.Length;
    report.ExpectedTitleMatches=expected!=null&&titles.Any(e=>e.Current.Name.Trim()==expected);report.VisibleTitleMatches=expected!=null&&titles.Any(e=>!e.Current.IsOffscreen&&e.Current.Name.Trim()==expected);
    report.TitleFormatCodes=titles.Length==0?new string[0]:titles[0].Current.Name.Where(c=>Char.GetUnicodeCategory(c)==System.Globalization.UnicodeCategory.Format).Select(c=>((int)c).ToString("X4")).ToArray();
    report.ExpectedUnformattedTitleMatches=expected!=null&&titles.Any(e=>new String(e.Current.Name.Where(c=>Char.GetUnicodeCategory(c)!=System.Globalization.UnicodeCategory.Format).ToArray()).Trim()==expected);
    report.ExpectedTitleSubstring=expected!=null&&titles.Any(e=>e.Current.Name.Contains(expected));
    report.Input=input!=null&&input.TryGetCurrentPattern(ValuePattern.Pattern,out value);
    report.Search=search!=null&&search.TryGetCurrentPattern(ValuePattern.Pattern,out value);
    report.Ready=report.Input||report.Search;return report;
  }
  public static bool Probe(string exe) { return ProbeState(exe).Ready; }
  public class TargetReport { public string Title; public string Input; public string SearchValue; public string Expected; public int Results; }
  public static TargetReport TargetState(string exe,string expected) {
    var root=Window(exe);var title=Find(root,"current_chat_name_label");var input=Find(root,"chat_input_field");
    var search=root.FindFirst(TreeScope.Descendants,new AndCondition(new PropertyCondition(AutomationElement.NameProperty,"搜索"),new PropertyCondition(AutomationElement.ControlTypeProperty,ControlType.Edit)));
    object value;var report=new TargetReport {Title=title==null?null:title.Current.Name,Input=input==null?null:input.Current.Name,Expected=expected,Results=SearchResults(root,expected).Length};
    if(search!=null&&search.TryGetCurrentPattern(ValuePattern.Pattern,out value))report.SearchValue=((ValuePattern)value).Current.Value;
    return report;
  }
  static bool IsChat(AutomationElement root,string name) {
    var title=Find(root,"current_chat_name_label");
    if(title!=null)return String.Equals(title.Current.Name.Trim(),name,StringComparison.Ordinal);
    var input=Find(root,"chat_input_field");
    return input!=null&&String.Equals(input.Current.Name,name,StringComparison.Ordinal);
  }
  static bool Activate(IntPtr handle) {
    if(GetForegroundWindow()==handle)return true;
    // PowerShell's pipeline thread may not have a Win32 input queue yet.
    // AttachThreadInput requires both queues to exist, even for a long-lived worker.
    NativeMessage message;PeekMessage(out message,IntPtr.Zero,0,0,0);
    uint ignored;uint current=GetCurrentThreadId();uint foreground=GetWindowThreadProcessId(GetForegroundWindow(),out ignored);uint target=GetWindowThreadProcessId(handle,out ignored);
    bool attachedForeground=false,attachedTarget=false;
    try {
      if(IsIconic(handle))ShowWindowAsync(handle,9);
      if(foreground!=0&&foreground!=current)attachedForeground=AttachThreadInput(current,foreground,true);
      if(target!=0&&target!=current&&target!=foreground)attachedTarget=AttachThreadInput(current,target,true);
      SetForegroundWindow(handle);
    }finally{
      if(attachedTarget)AttachThreadInput(current,target,false);
      if(attachedForeground)AttachThreadInput(current,foreground,false);
    }
    for(int i=0;i<20;i++){if(GetForegroundWindow()==handle)return true;Thread.Sleep(50);}
    return false;
  }
  static void KeyboardIdle(){if((GetAsyncKeyState(0x10)&0x8000)!=0||(GetAsyncKeyState(0x11)&0x8000)!=0||(GetAsyncKeyState(0x12)&0x8000)!=0)throw new Exception("FOREGROUND_KEYBOARD_BUSY");}
  public static bool Focus(string exe){KeyboardIdle();if(!Activate(WindowHandle(exe)))throw new Exception("FOREGROUND_FOCUS_REQUIRED");return true;}
  static AutomationElement WaitForChat(string exe,string name) {
    for(int i=0;i<20;i++){
      try{var root=Window(exe);if(Find(root,"chat_input_field")!=null&&IsChat(root,name))return root;}catch(ElementNotAvailableException){}
      Thread.Sleep(50);
    }
    return null;
  }
  static AutomationElement[] SearchResults(AutomationElement root,string name) {
    var list=Find(root,"search_list");if(list==null)return new AutomationElement[0];
    return list.FindAll(TreeScope.Descendants,Condition.TrueCondition).Cast<AutomationElement>()
      .Where(e=>e.Current.AutomationId.Split('.').Last().StartsWith("search_item_")&&e.Current.Name.Split('\n')[0].Trim()==name).ToArray();
  }
  static AutomationElement OpenChat(string exe,string name) {
    var root=Window(exe);var handle=WindowHandle(exe);
    KeyboardIdle();if(!Activate(handle))throw new Exception("FOREGROUND_FOCUS_REQUIRED");
    var input=Find(root,"chat_input_field");
    if(input==null||!IsChat(root,name)){
      var search=root.FindFirst(TreeScope.Descendants,new AndCondition(new PropertyCondition(AutomationElement.NameProperty,"搜索"),new PropertyCondition(AutomationElement.ControlTypeProperty,ControlType.Edit)));
      if(search==null)throw new Exception("FOREGROUND_SEARCH_UNAVAILABLE");
      Fill(search,name);
      var searchClock=Stopwatch.StartNew();string lastResult=null;int stable=0;
      while(searchClock.ElapsedMilliseconds<650){
        var candidates=SearchResults(Window(exe),name);
        if(candidates.Length>1)throw new Exception("FOREGROUND_TARGET_AMBIGUOUS");
        var identity=candidates.Length==1?candidates[0].Current.AutomationId+"\n"+candidates[0].Current.Name:null;
        stable=identity!=null&&identity==lastResult?stable+1:0;lastResult=identity;
        if(stable>=1)break;
        Thread.Sleep(50);
      }
      var list=Find(root,"search_list");
      if(list==null)throw new Exception("FOREGROUND_SEARCH_EMPTY");
      var results=SearchResults(root,name);
      if(results.Length!=1||!ClickPhysical(results[0]))throw new Exception("FOREGROUND_TARGET_AMBIGUOUS");
      var opened=WaitForChat(exe,name);
      if(opened==null){
        var current=Window(exe);var fresh=SearchResults(current,name);
        if(GetForegroundWindow()==handle&&fresh.Length==1&&ClickPhysical(fresh[0]))opened=WaitForChat(exe,name);
      }
      if(opened!=null)root=opened;input=Find(root,"chat_input_field");
    }
    if(input==null||!IsChat(root,name)||GetForegroundWindow()!=handle)throw new Exception("FOREGROUND_TARGET_CHANGED");
    return root;
  }
  // Navigation is independently testable without filling or submitting a message.
  public static bool Navigate(string exe,string name) { return OpenChat(exe,name)!=null; }
  static AutomationElement EmptyInput(AutomationElement root,string name){
    var input=Find(root,"chat_input_field");
    if(input==null||!IsChat(root,name))throw new Exception("FOREGROUND_TARGET_CHANGED");
    object pattern;
    // Never overwrite a user's unsent draft.
    if(!input.TryGetCurrentPattern(ValuePattern.Pattern,out pattern)||!String.IsNullOrEmpty(((ValuePattern)pattern).Current.Value))throw new Exception("FOREGROUND_DRAFT_PRESENT");
    return input;
  }
  public static bool Send(string exe,string name,string text) {
    var root=OpenChat(exe,name);var handle=WindowHandle(exe);var input=EmptyInput(root,name);
    KeyboardIdle();
    input.SetFocus();if(!input.Current.HasKeyboardFocus){if(!ClickPhysical(input))throw new Exception("FOREGROUND_FOCUS_CHANGED");Thread.Sleep(100);}
    input=EmptyInput(root,name);bool filled=false;
    try{
      Fill(input,text);filled=true;
      if(!IsChat(root,name)||GetForegroundWindow()!=handle||!input.Current.HasKeyboardFocus)throw new Exception("FOREGROUND_FOCUS_CHANGED");
      object pattern;if(!input.TryGetCurrentPattern(ValuePattern.Pattern,out pattern)||((ValuePattern)pattern).Current.Value!=text)throw new Exception("FOREGROUND_TEXT_CHANGED");
      KeyboardIdle();Attempted=true;SendKeys.SendWait("{ENTER}");
      return true; // Submission only. The parent confirms using the message database.
    }finally{
      if(filled&&!Attempted){try{object pattern;if(IsChat(root,name)&&input.TryGetCurrentPattern(ValuePattern.Pattern,out pattern)&&((ValuePattern)pattern).Current.Value==text)Fill(input,"");}catch{}}
    }
  }
  static bool Visible(AutomationElement e){var r=e.Current.BoundingRectangle;return !e.Current.IsOffscreen&&!r.IsEmpty&&r.Width>=16&&r.Height>=16;}
  static AutomationElement[] Controls(AutomationElement root){return root.FindAll(TreeScope.Descendants,Condition.TrueCondition).Cast<AutomationElement>().ToArray();}
  static AutomationElement Panel(AutomationElement root){
    var panel=Controls(root).FirstOrDefault(e=>Visible(e)&&(e.Current.ClassName.ToLowerInvariant()=="mmui::emoticonpanel"||e.Current.ClassName.ToLowerInvariant()=="mmui::emoticonpopover"));
    if(panel!=null)return panel;
    return AutomationElement.RootElement.FindAll(TreeScope.Children,Condition.TrueCondition).Cast<AutomationElement>().FirstOrDefault(e=>e.Current.ProcessId==root.Current.ProcessId&&Visible(e)&&(e.Current.ClassName.ToLowerInvariant()=="mmui::emoticonpanel"||e.Current.ClassName.ToLowerInvariant()=="mmui::emoticonpopover"));
  }
  static AutomationElement[] Favorites(AutomationElement panel,bool generic){return Controls(panel).Where(e=>{
    var cls=e.Current.ClassName.ToLowerInvariant();var r=e.Current.BoundingRectangle;
    return Visible(e)&&r.Width<=320&&r.Height<=320&&(cls=="mmui::favemoticonitemview"||e.Current.AutomationId.ToLowerInvariant().Contains("favemoticon")||generic&&(cls=="mmui::emoticonitemview"||cls=="mmui::commonemoticonview"));
  }).ToArray();}
  public static bool SendFavorite(string exe,string name){
    var root=OpenChat(exe,name);EmptyInput(root,name);
    var launcher=Controls(root).FirstOrDefault(e=>Visible(e)&&(e.Current.AutomationId=="chat_text_emoticon_view"||e.Current.Name=="发送表情"||e.Current.Name=="表情"||e.Current.ClassName=="mmui::EmoticonView"));
    var panel=Panel(root);
    if(panel==null){if(launcher==null||!Click(launcher))throw new Exception("FOREGROUND_STICKER_PANEL_UNAVAILABLE");Thread.Sleep(400);panel=Panel(root);}
    if(panel==null)throw new Exception("FOREGROUND_STICKER_PANEL_UNAVAILABLE");
    var items=Favorites(panel,false);
    if(items.Length==0){
      var tab=Controls(panel).FirstOrDefault(e=>Visible(e)&&e.Current.ClassName.ToLowerInvariant()=="mmui::emoticontoolbaritem"&&(e.Current.Name.Contains("收藏")||e.Current.Name.Contains("自定义表情")||(e.Current.AutomationId+e.Current.Name).ToLowerInvariant().Contains("fav")));
      if(tab==null||!Click(tab))throw new Exception("FOREGROUND_FAVORITES_TAB_UNAVAILABLE");
      Thread.Sleep(300);panel=Panel(root);if(panel==null)throw new Exception("FOREGROUND_STICKER_PANEL_UNAVAILABLE");items=Favorites(panel,true);
    }
    if(items.Length==0)throw new Exception("FOREGROUND_FAVORITES_EMPTY");
    EmptyInput(root,name);
    var foreground=AutomationElement.FromHandle(GetForegroundWindow());
    if(foreground.Current.ProcessId!=root.Current.ProcessId)throw new Exception("FOREGROUND_FOCUS_CHANGED");
    Attempted=true;if(!Click(items[random.Next(items.Length)]))throw new Exception("FOREGROUND_FAVORITE_NOT_CLICKED");
    return true;
  }
}
