using System;
using System.IO;
using System.Net;
using System.Diagnostics;
using System.Drawing;
using System.Threading.Tasks;
using System.Windows.Forms;
using System.Runtime.InteropServices;
using System.Security.Cryptography.X509Certificates;
using System.Text.RegularExpressions;
using Microsoft.Win32;

static class RuntimePrerequisites {
    [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)]struct TrustFile {public uint size;[MarshalAs(UnmanagedType.LPWStr)]public string path;public IntPtr handle,subject;}
    [StructLayout(LayoutKind.Sequential)]struct TrustData {public uint size;public IntPtr policy,sip;public uint ui,revocation,choice;public IntPtr file;public uint action;public IntPtr state,url;public uint flags,context;public IntPtr settings;}
    [DllImport("wintrust.dll",ExactSpelling=true,SetLastError=false,CharSet=CharSet.Unicode)]static extern int WinVerifyTrust(IntPtr window,ref Guid action,ref TrustData data);
    internal static bool SignedByMicrosoft(string file){
        var info=new TrustFile{size=(uint)Marshal.SizeOf(typeof(TrustFile)),path=file};var pointer=Marshal.AllocHGlobal(Marshal.SizeOf(typeof(TrustFile)));Marshal.StructureToPtr(info,pointer,false);
        var data=new TrustData{size=(uint)Marshal.SizeOf(typeof(TrustData)),ui=2,revocation=1,choice=1,file=pointer,action=1};var action=new Guid("00AAC56B-CD44-11d0-8CC2-00C04FC295EE");
        try{if(WinVerifyTrust(IntPtr.Zero,ref action,ref data)!=0)return false;using(var certificate=new X509Certificate2(X509Certificate.CreateFromSignedFile(file)))return Regex.IsMatch(certificate.Subject,@"O=Microsoft Corporation(,|$)");}catch{return false;}
        finally{data.action=2;WinVerifyTrust(IntPtr.Zero,ref action,ref data);Marshal.DestroyStructure(pointer,typeof(TrustFile));Marshal.FreeHGlobal(pointer);}
    }
    const string Client="Microsoft\\EdgeUpdate\\Clients\\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}";
    internal static bool HasWebView(){
        var custom=Environment.GetEnvironmentVariable("WEBVIEW2_BROWSER_EXECUTABLE_FOLDER");
        if(!String.IsNullOrEmpty(custom)&&File.Exists(Path.Combine(custom,"msedgewebview2.exe")))return true;
        foreach(var hive in new[]{RegistryHive.LocalMachine,RegistryHive.CurrentUser})foreach(var view in new[]{RegistryView.Registry32,RegistryView.Registry64})try{using(var root=RegistryKey.OpenBaseKey(hive,view))using(var key=root.OpenSubKey("SOFTWARE\\"+Client)){var version=key==null?null:key.GetValue("pv") as string;Version parsed;if(Version.TryParse(version,out parsed)&&parsed>new Version(0,0,0,0))return true;}}catch{}
        return false;
    }
    internal static bool EnsureWebView(string root){
        if(HasWebView())return true;
        using(var form=new Form())using(var client=new WebClient()){
            form.Text="小鱼 · 准备桌面运行环境";form.Size=new Size(560,240);form.StartPosition=FormStartPosition.CenterScreen;form.FormBorderStyle=FormBorderStyle.FixedDialog;form.MaximizeBox=false;
            var label=new Label{Text="需要 Microsoft WebView2 Runtime 才能打开小鱼。\n可下载微软官方安装器，并在官方向导中完成安装。",Dock=DockStyle.Top,Height=80,Padding=new Padding(16)};
            var progress=new ProgressBar{Dock=DockStyle.Top,Height=20};
            var buttons=new FlowLayoutPanel{Dock=DockStyle.Bottom,Height=60,Padding=new Padding(12)};
            var install=new Button{Text="下载并安装",AutoSize=true};var retry=new Button{Text="重新检测",AutoSize=true};var cancel=new Button{Text="稍后",AutoSize=true};var official=new LinkLabel{Text="微软下载页",AutoSize=true,Margin=new Padding(8,8,0,0)};official.LinkClicked+=(s,e)=>{try{Process.Start(new ProcessStartInfo("https://developer.microsoft.com/microsoft-edge/webview2/#download-section"){UseShellExecute=true});}catch{label.Text="请访问微软WebView2官方下载页面。";}};buttons.Controls.AddRange(new Control[]{install,retry,cancel,official});form.Controls.Add(progress);form.Controls.Add(label);form.Controls.Add(buttons);
            cancel.Click+=(s,e)=>form.Close();retry.Click+=(s,e)=>{if(HasWebView()){form.DialogResult=DialogResult.OK;form.Close();}else label.Text="尚未检测到运行时，请先完成微软安装程序后重新检测。";};
            client.DownloadProgressChanged+=(s,e)=>{if(!form.IsDisposed)progress.Value=Math.Max(0,Math.Min(100,e.ProgressPercentage));};
            form.FormClosed+=(s,e)=>client.CancelAsync();
            install.Click+=async(s,e)=>{
                install.Enabled=false;var directory=Path.Combine(root,"data","dependencies");Directory.CreateDirectory(directory);var target=Path.Combine(directory,"MicrosoftEdgeWebview2Setup.exe");var partial=target+".part";
                try{
                    label.Text="正在下载微软官方安装器…";ServicePointManager.SecurityProtocol|=SecurityProtocolType.Tls12;
                    var download=client.DownloadFileTaskAsync(new Uri("https://go.microsoft.com/fwlink/p/?LinkId=2124703"),partial);
                    if(await Task.WhenAny(download,Task.Delay(120000))!=download){client.CancelAsync();try{await download;}catch{}throw new Exception("官方下载超时，请重试。");}await download;
                    if(new FileInfo(partial).Length>64*1024*1024)throw new Exception("安装器大小异常。");
                    var verification=Task.Run(()=>SignedByMicrosoft(partial));bool valid=await Task.WhenAny(verification,Task.Delay(20000))==verification&&verification.Result;
                    if(!valid)throw new Exception("微软数字签名校验未通过，请使用官方下载页面重试。");
                    if(File.Exists(target))File.Delete(target);File.Move(partial,target);
                    label.Text="请在微软官方安装程序中完成安装，之后点击重新检测。";
                    using(var installer=Process.Start(new ProcessStartInfo(target){UseShellExecute=true})){await Task.Run(()=>installer.WaitForExit());}
                    if(!form.IsDisposed&&HasWebView()){form.DialogResult=DialogResult.OK;form.Close();}
                }catch(Exception error){if(!form.IsDisposed)label.Text="未完成安装："+error.Message+"\n可重试，或按随包使用说明从微软网站获取安装器。";}
                finally{try{if(File.Exists(partial))File.Delete(partial);}catch{}if(!form.IsDisposed)install.Enabled=true;}
            };
            return form.ShowDialog()==DialogResult.OK&&HasWebView();
        }
    }
}
