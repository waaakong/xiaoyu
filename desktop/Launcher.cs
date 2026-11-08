using System;
using System.IO;
using System.Diagnostics;
using System.Text;
using System.Runtime.InteropServices;
using System.Windows.Forms;

static class Launcher {
    [DllImport("user32.dll",CharSet=CharSet.Unicode)]static extern IntPtr FindWindow(string cls,string title);
    [DllImport("user32.dll")]static extern bool ShowWindow(IntPtr handle,int command);
    [DllImport("user32.dll")]static extern bool SetForegroundWindow(IntPtr handle);
    [STAThread]static int Main(string[] args){
        Application.EnableVisualStyles();
        try{
            var home=AppDomain.CurrentDomain.BaseDirectory;
            var root=Path.Combine(home,"app");bool diagnose=false;
            for(int i=0;i<args.Length;i++){
                if(args[i]=="--project"&&i+1<args.Length)root=Path.GetFullPath(args[++i]);
                else if(args[i]=="--diagnose")diagnose=true;
                else throw new Exception("无法识别的启动参数。");
            }
            if(!diagnose){var old=FindWindow(null,"小鱼 · 陪伴工作台");if(old!=IntPtr.Zero){ShowWindow(old,9);SetForegroundWindow(old);return 0;}}
            var node=Path.Combine(home,"runtime","node.exe");
            var entry=Path.Combine(root,"src",diagnose?"package-check.js":"desktop-launch.js");
            if(!File.Exists(node)||!File.Exists(entry))throw new Exception("程序文件不完整，请完整解压整个小鱼文件夹后运行，不要只移动EXE。");
            if(!diagnose&&!RuntimePrerequisites.EnsureWebView(root))return 0;
            Directory.CreateDirectory(Path.Combine(root,"data"));
            var info=new ProcessStartInfo(node,"\""+entry+"\"");info.WorkingDirectory=root;info.UseShellExecute=false;info.CreateNoWindow=true;info.WindowStyle=ProcessWindowStyle.Hidden;info.RedirectStandardError=true;
            var errors=new StringBuilder();
            using(var process=new Process()){
                process.StartInfo=info;process.ErrorDataReceived+=(s,e)=>{if(e.Data!=null&&errors.Length<8192)errors.AppendLine(e.Data);};
                process.Start();process.BeginErrorReadLine();process.WaitForExit();
                if(process.ExitCode!=0){var log=Path.Combine(root,"data","desktop-startup.log");File.WriteAllText(log,errors.ToString());if(!diagnose)MessageBox.Show("小鱼未能启动。请查看本机日志：\n"+log,"小鱼",MessageBoxButtons.OK,MessageBoxIcon.Error);}
                return process.ExitCode;
            }
        }catch(Exception e){MessageBox.Show(e.Message,"小鱼启动失败",MessageBoxButtons.OK,MessageBoxIcon.Error);return 1;}
    }
}
