using System;
using System.IO;
using System.Drawing;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;
using System.Web.Script.Serialization;
using Microsoft.Web.WebView2.WinForms;
using Microsoft.Web.WebView2.Core;

class PluginPanelWindow : Form {
    readonly string root, panelOrigin, panelKind;
    readonly WebView2 view=new WebView2();
    readonly Label status=new Label();
    readonly System.Windows.Forms.Timer timeout=new System.Windows.Forms.Timer();
    Action<bool,string> waiting;
    bool ready, completed;
    ulong navigationId;
    public const string PanelTitle="小鱼 · AstrBot 插件管理";
    public PluginPanelWindow(string projectRoot):this(projectRoot,"astrbot",6185){}
    public PluginPanelWindow(string projectRoot,string kind,int port){
        root=projectRoot;panelKind=kind;panelOrigin="http://127.0.0.1:"+port+"/";Text=kind=="astrbot"?PanelTitle:"小鱼 · "+kind+" 接入管理";Size=new Size(1180,820);MinimumSize=new Size(900,600);StartPosition=FormStartPosition.CenterParent;
        BackColor=Color.FromArgb(16,22,32);view.DefaultBackgroundColor=BackColor;view.Dock=DockStyle.Fill;Controls.Add(view);
        status.Text="正在连接本机 AstrBot 管理面板…";status.Height=36;status.Dock=DockStyle.Top;status.Padding=new Padding(12,8,0,0);status.ForeColor=Color.LightSteelBlue;status.BackColor=BackColor;Controls.Add(status);
        try{Icon=new Icon(Path.Combine(root,"desktop","icon.ico"),32,32);}catch{}
        timeout.Interval=20000;timeout.Tick+=(s,e)=>Finish(false,"管理窗口加载超时，请检查AstrBot状态，或复制地址在浏览器中打开。");
        Shown+=async(s,e)=>{timeout.Start();try{
            var environment=await CoreWebView2Environment.CreateAsync(null,Path.Combine(root,"data",panelKind+"-panel-profile"),null);
            await view.EnsureCoreWebView2Async(environment);if(IsDisposed)return;
            view.CoreWebView2.Settings.AreDevToolsEnabled=false;view.CoreWebView2.Settings.AreDefaultContextMenusEnabled=false;
            view.CoreWebView2.PermissionRequested+=(sender,args)=>args.State=CoreWebView2PermissionState.Deny;
            view.CoreWebView2.NewWindowRequested+=(sender,args)=>{args.Handled=true;status.Text="外部新窗口未自动打开，请在浏览器访问该链接。";};
            view.CoreWebView2.NavigationStarting+=(sender,args)=>{if(!AllowedTarget(args.Uri))args.Cancel=true;else navigationId=args.NavigationId;};
            view.CoreWebView2.NavigationCompleted+=(sender,args)=>{if(!completed&&navigationId!=0&&args.NavigationId==navigationId)Finish(args.IsSuccess,args.IsSuccess?null:"面板页面加载失败："+args.WebErrorStatus.ToString());};
            view.CoreWebView2.Navigate(panelOrigin);
        }catch{Finish(false,"无法初始化插件管理窗口，请复制管理地址到浏览器。");}};
        FormClosed+=(s,e)=>{timeout.Stop();if(!completed)Finish(false,"插件管理窗口已关闭。");Record("closed",null);timeout.Dispose();view.Dispose();};
    }
    bool AllowedTarget(string value){Uri u;return Uri.TryCreate(value,UriKind.Absolute,out u)&&u.GetLeftPart(UriPartial.Authority)==panelOrigin.TrimEnd('/')&&String.IsNullOrEmpty(u.UserInfo);}
    internal static bool AllowedAddress(string value){Uri u;return Uri.TryCreate(value,UriKind.Absolute,out u)&&u.Scheme=="http"&&u.Host=="127.0.0.1"&&u.Port==6185&&String.IsNullOrEmpty(u.UserInfo);}
    public void Present(Form owner,Action<bool,string> completion){if(ready){Record("ready",null);Show();WindowState=FormWindowState.Normal;Activate();completion(true,null);return;}if(completed){completion(false,"管理窗口未就绪，请关闭后重新打开。");return;}waiting+=completion;Record("opening",null);if(!Visible)Show(owner);WindowState=FormWindowState.Normal;Activate();}
    void Finish(bool ok,string error){if(completed)return;completed=true;ready=ok;timeout.Stop();status.Text=ok?"本机 "+panelKind+" · 首次设置与登录由官方页面提供":error;Record(ok?"ready":"failed",error);var callbacks=waiting;waiting=null;if(callbacks!=null)callbacks(ok,error);}
    void Record(string state,string error){try{File.WriteAllText(Path.Combine(root,"data",panelKind=="astrbot"?"plugin-panel-status.json":"protocol-panel-status.json"),new JavaScriptSerializer().Serialize(new{state=state,error=error,mode="embedded",time=DateTime.UtcNow.ToString("o")}));}catch{}}
}

class CompanionWindow : Form {
    readonly string root, url, origin;
    readonly WebView2 web = new WebView2();
    readonly NotifyIcon tray = new NotifyIcon();
    bool quitting, dirty;
    PluginPanelWindow pluginPanel, protocolPanel;
    string protocolPanelTag;
    public const string WindowTitle = "小鱼 · 陪伴工作台";
    public CompanionWindow(string projectRoot, string endpoint) {
        root=projectRoot;url=endpoint;origin=new Uri(url).GetLeftPart(UriPartial.Authority);
        try{File.WriteAllText(Path.Combine(root,"data","plugin-panel-status.json"),new JavaScriptSerializer().Serialize(new{state="not-opened",mode="embedded",time=DateTime.UtcNow.ToString("o")}));}catch{}
        FormBorderStyle=FormBorderStyle.None;Padding=new Padding(6);AutoScaleMode=AutoScaleMode.Dpi;Text=WindowTitle;Size=new Size(1250,850);MinimumSize=new Size(960,650);StartPosition=FormStartPosition.CenterScreen;MaximizedBounds=Screen.FromControl(this).WorkingArea;LocationChanged+=(s,e)=>{if(WindowState==FormWindowState.Normal)MaximizedBounds=Screen.FromControl(this).WorkingArea;};
        BackColor=Color.FromArgb(16,22,32);web.DefaultBackgroundColor=BackColor;Font=new Font("Microsoft YaHei UI",9);
        try { Icon=new Icon(Path.Combine(root,"desktop","icon.ico"),32,32); } catch {}
        var prefs=Path.Combine(root,"data","desktop-window.json");
        try { var p=new JavaScriptSerializer().Deserialize<System.Collections.Generic.Dictionary<string,int>>(File.ReadAllText(prefs));Size=new Size(Math.Max(960,Math.Min(2000,p["width"])),Math.Max(650,Math.Min(1400,p["height"]))); } catch {}
        web.Dock=DockStyle.Fill;Controls.Add(web);
        tray.Icon=Icon;tray.Text="小鱼 · QQ 陪伴";tray.Visible=true;
        var menu=new ContextMenuStrip();menu.Items.Add("打开小鱼",null,(s,e)=>BringBack());menu.Items.Add(new ToolStripSeparator());menu.Items.Add("退出并停止服务",null,(s,e)=>RequestQuit());tray.ContextMenuStrip=menu;tray.DoubleClick+=(s,e)=>BringBack();
        FormClosing+=(s,e)=>{if(!quitting){e.Cancel=true;Hide();}};
        FormClosed+=(s,e)=>{tray.Dispose();try {var size=RestoreBounds.Size;File.WriteAllText(prefs,"{\"width\":"+size.Width+",\"height\":"+size.Height+"}");}catch{}web.Dispose();};
        var boundsTimer=new System.Windows.Forms.Timer();boundsTimer.Interval=500;
        Resize+=(s,e)=>{Padding=new Padding(WindowState==FormWindowState.Maximized?0:Math.Max(6,(int)Math.Round(DeviceDpi*6.0/96)));PublishWindowState();if(WindowState==FormWindowState.Normal){boundsTimer.Stop();boundsTimer.Start();}};
        boundsTimer.Tick+=(s,e)=>{boundsTimer.Stop();try{File.WriteAllText(prefs,"{\"width\":"+Width+",\"height\":"+Height+"}");}catch{}};
        Shown+=async(s,e)=>{
            try {
                var environment=await CoreWebView2Environment.CreateAsync(null,Path.Combine(root,"data","webview-profile"),null);
                await web.EnsureCoreWebView2Async(environment);
                web.CoreWebView2.Settings.IsNonClientRegionSupportEnabled=true;
                web.CoreWebView2.Settings.AreDevToolsEnabled=false;
                web.CoreWebView2.Settings.AreDefaultContextMenusEnabled=false;
                web.CoreWebView2.PermissionRequested+=(sender,args)=>args.State=CoreWebView2PermissionState.Deny;
                web.CoreWebView2.NavigationStarting+=(sender,args)=>{Uri dest;if(!Uri.TryCreate(args.Uri,UriKind.Absolute,out dest)||dest.GetLeftPart(UriPartial.Authority)!=origin)args.Cancel=true;};
                web.CoreWebView2.NewWindowRequested+=(sender,args)=>{args.Handled=true;if(IsPluginPanel(args.Uri))OpenPluginPanel((ok,error)=>{if(!ok)MessageBox.Show(error,"小鱼",MessageBoxButtons.OK,MessageBoxIcon.Warning);});};
                web.CoreWebView2.WebMessageReceived+=(sender,args)=>{if(!args.Source.StartsWith(origin+"/",StringComparison.Ordinal))return;try {var message=new JavaScriptSerializer().Deserialize<System.Collections.Generic.Dictionary<string,object>>(args.TryGetWebMessageAsString());var type=(string)message["type"];if(type=="window-action"){var action=message["action"] as string;if(action=="minimize")WindowState=FormWindowState.Minimized;else if(action=="maximize"){MaximizedBounds=Screen.FromHandle(Handle).WorkingArea;WindowState=WindowState==FormWindowState.Maximized?FormWindowState.Normal:FormWindowState.Maximized;}else if(action=="close")Close();else if(action=="state")PublishWindowState();}else if(type=="dirty")dirty=(bool)message["value"];else if(type=="theme"){var theme=message["value"] as string;if(theme=="dark"||theme=="light")SetWindowTheme(theme=="dark");}else if(type=="open-service-panel"){object id,kind;if(!message.TryGetValue("id",out id)||!(id is int)||!message.TryGetValue("kind",out kind)||!(kind is string))return;OpenProtocolPanel((string)kind,(ok,error)=>{if(!IsDisposed&&!web.IsDisposed)web.CoreWebView2.PostWebMessageAsJson(new JavaScriptSerializer().Serialize(new {type="panel-open-result",id=id,ok=ok,error=error}));});}else if(type=="open-plugin-panel"){object id; if(!message.TryGetValue("id",out id)||!(id is int))return;OpenPluginPanel((ok,error)=>{if(!IsDisposed&&!web.IsDisposed)web.CoreWebView2.PostWebMessageAsJson(new JavaScriptSerializer().Serialize(new {type="panel-open-result",id=id,ok=ok,error=error}));});}}catch{}};
                web.CoreWebView2.WebMessageReceived+=(sender,args)=>{
                    if(!args.Source.StartsWith(origin+"/",StringComparison.Ordinal))return;
                    try{var m=new JavaScriptSerializer().Deserialize<System.Collections.Generic.Dictionary<string,object>>(args.TryGetWebMessageAsString());object type,key;if(m.TryGetValue("type",out type)&&(type as string)=="open-dependency-page"&&m.TryGetValue("key",out key)&&key is string)OpenDependencyPage((string)key);}catch{}
                };
                await web.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync(File.ReadAllText(Path.Combine(root,"desktop","bridge.js")));
                web.CoreWebView2.Navigate(url);
            } catch(Exception ex) {MessageBox.Show("原生窗口初始化失败："+ex.Message,"小鱼",MessageBoxButtons.OK,MessageBoxIcon.Error);quitting=true;Close();}
        };
    }
    void PublishWindowState(){if(web.CoreWebView2!=null&&!web.IsDisposed)web.CoreWebView2.PostWebMessageAsJson(new JavaScriptSerializer().Serialize(new{type="window-state",maximized=WindowState==FormWindowState.Maximized}));}
    protected override CreateParams CreateParams{get{var p=base.CreateParams;p.Style=(p.Style&~0x00C00000)|0x00040000|0x00020000|0x00010000|0x00080000;p.ExStyle&=~(0x00000100|0x00000200|0x00020000);return p;}}
    protected override void OnHandleCreated(EventArgs e){base.OnHandleCreated(e);ApplyBorderlessFrame();}
    void ApplyBorderlessFrame(){try{int policy=1;DwmSetWindowAttribute(Handle,2,ref policy,4);int noBorder=unchecked((int)0xFFFFFFFE);DwmSetWindowAttribute(Handle,34,ref noBorder,4);}catch{}}
    [StructLayout(LayoutKind.Sequential)]struct NativePoint{public int x,y;}
    [StructLayout(LayoutKind.Sequential)]struct MinMaxInfo{public NativePoint reserved,maxSize,maxPosition,minTrackSize,maxTrackSize;}
    protected override void WndProc(ref Message m){
        // Win10 otherwise draws a light resize outline, even with a zero NC area.
        // Keep WS_THICKFRAME and our hit testing; suppress only its native paint.
        if(m.Msg==0x85){m.Result=IntPtr.Zero;return;}
        if(m.Msg==0x86){m.Result=(IntPtr)1;return;}
        if(m.Msg==0x31E||m.Msg==0x31A){base.WndProc(ref m);ApplyBorderlessFrame();return;}
        if(m.Msg==0x83&&m.WParam!=IntPtr.Zero){m.Result=IntPtr.Zero;return;}
        if(m.Msg==0x24){base.WndProc(ref m);var screen=Screen.FromHandle(Handle);var work=screen.WorkingArea;var info=(MinMaxInfo)Marshal.PtrToStructure(m.LParam,typeof(MinMaxInfo));info.maxPosition.x=work.Left-screen.Bounds.Left;info.maxPosition.y=work.Top-screen.Bounds.Top;info.maxSize.x=work.Width;info.maxSize.y=work.Height;Marshal.StructureToPtr(info,m.LParam,false);m.Result=IntPtr.Zero;return;}
        if(m.Msg==0x84&&WindowState==FormWindowState.Normal){var point=PointToClient(new Point(unchecked((short)(long)m.LParam),unchecked((short)((long)m.LParam>>16))));int edge=Padding.Left;bool left=point.X<edge,right=point.X>=ClientSize.Width-edge,top=point.Y<edge,bottom=point.Y>=ClientSize.Height-edge;int hit=top?(left?13:right?14:12):bottom?(left?16:right?17:15):left?10:right?11:0;if(hit!=0){m.Result=(IntPtr)hit;return;}}
        base.WndProc(ref m);
    }
    void BringBack(){Show();if(WindowState==FormWindowState.Minimized)WindowState=FormWindowState.Normal;Activate();}
    [DllImport("dwmapi.dll")]static extern int DwmSetWindowAttribute(IntPtr hwnd,int attribute,ref int value,int size);
    void SetWindowTheme(bool dark){BackColor=dark?Color.FromArgb(16,22,32):Color.FromArgb(243,246,251);web.DefaultBackgroundColor=BackColor;try{int value=dark?1:0;DwmSetWindowAttribute(Handle,20,ref value,4);}catch{}ApplyBorderlessFrame();}
    static bool IsPluginPanel(string value){Uri u;return Uri.TryCreate(value,UriKind.Absolute,out u)&&u.AbsoluteUri=="http://127.0.0.1:6185/";}
    void OpenPluginPanel(Action<bool,string> completion){try{if(pluginPanel==null||pluginPanel.IsDisposed)pluginPanel=new PluginPanelWindow(root);pluginPanel.Present(this,completion);}catch{completion(false,"无法创建插件管理窗口，请复制管理地址。");}}
    void OpenDependencyPage(string key){
        var pages=new System.Collections.Generic.Dictionary<string,string>{
            {"edge","https://www.microsoft.com/edge/download"},{"webview2","https://developer.microsoft.com/microsoft-edge/webview2/#download-section"},{"dotnet","https://dotnet.microsoft.com/en-us/download/dotnet-framework/net48"},
            {"python","https://docs.astral.sh/uv/guides/install-python/"},{"astrbot","https://docs.astrbot.app/en/deploy/astrbot/package.html"},
            {"snowluma","https://github.com/SnowLuma/SnowLuma/releases"},{"napcat","https://napneko.github.io/guide/boot/Shell"},{"qq","https://im.qq.com/pcqq/index.shtml"},{"codex","https://openai.com/codex/"},{"voice","https://github.com/RVC-Boss/GPT-SoVITS"},{"speech","https://github.com/QwenAudio/SenseVoice"}};
        string address;if(!pages.TryGetValue(key,out address))return;
        try{Process.Start(new ProcessStartInfo(address){UseShellExecute=true});}catch{MessageBox.Show("无法打开浏览器，请按使用说明访问官方页面。","小鱼");}
    }
    int ProtocolPort(string kind){
        if(kind!="snowluma"&&kind!="napcat")throw new Exception("服务名称无效");
        var serializer=new JavaScriptSerializer();var c=serializer.Deserialize<System.Collections.Generic.Dictionary<string,object>>(File.ReadAllText(Path.Combine(root,"data","services.json")));
        if(!c.ContainsKey("protocol")||(string)c["protocol"]!=kind)throw new Exception("请选择已配置的协议端");
        int port=6099;
        if(kind=="snowluma"){port=5099;var file=Path.Combine((string)c["snowlumaPath"],"config","runtime.json");if(File.Exists(file)){var r=serializer.Deserialize<System.Collections.Generic.Dictionary<string,object>>(File.ReadAllText(file));if(r.ContainsKey("webuiPort"))port=Convert.ToInt32(r["webuiPort"]);}}
        else if(c.ContainsKey("napcatPort"))port=Convert.ToInt32(c["napcatPort"]);
        if(port<1024||port>65535)throw new Exception("协议控制台端口无效");return port;
    }
    void OpenProtocolPanel(string kind,Action<bool,string> completion){try{int port=ProtocolPort(kind);string tag=kind+":"+port;if(protocolPanel!=null&&!protocolPanel.IsDisposed&&protocolPanelTag!=tag)protocolPanel.Close();if(protocolPanel==null||protocolPanel.IsDisposed){protocolPanel=new PluginPanelWindow(root,kind,port);protocolPanelTag=tag;}protocolPanel.Present(this,completion);}catch{completion(false,"无法打开协议管理，请先保存服务路径并启动协议端。");}}
    void RequestQuit(){if(dirty&&MessageBox.Show("有未保存的设置。退出会放弃更改并停止服务，是否继续？","小鱼",MessageBoxButtons.YesNo,MessageBoxIcon.Question)!=DialogResult.Yes)return;quitting=true;Close();}
}
static class Program {
    [DllImport("user32.dll",CharSet=CharSet.Unicode)]static extern IntPtr FindWindow(string cls,string title);
    [DllImport("user32.dll")]static extern bool ShowWindow(IntPtr h,int command);
    [DllImport("user32.dll")]static extern bool SetForegroundWindow(IntPtr h);
    [STAThread]static void Main(string[] args){
        bool created;using(var mutex=new Mutex(true,"Local\\CodexQQCompanionNative",out created)){
            if(!created){var old=FindWindow(null,CompanionWindow.WindowTitle);if(old!=IntPtr.Zero){ShowWindow(old,9);SetForegroundWindow(old);}return;}
            Application.EnableVisualStyles();Application.SetCompatibleTextRenderingDefault(false);
            try {var url=Console.In.ReadLine();if(args.Length!=1||String.IsNullOrWhiteSpace(url))return;var parsed=new Uri(url);if(parsed.Host!="127.0.0.1"||parsed.Scheme!="http")return;Application.Run(new CompanionWindow(args[0],url));}
            catch(Exception ex){MessageBox.Show(ex.Message,"小鱼启动失败",MessageBoxButtons.OK,MessageBoxIcon.Error);}
        }
    }
}
