# Read-only resource ownership check. Never requests application shutdown.
$ErrorActionPreference='Stop'
$OutputEncoding=[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false)
[Console]::InputEncoding=New-Object System.Text.UTF8Encoding($false)
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
public static class XiaoyuResources {
  [StructLayout(LayoutKind.Sequential)] public struct UniqueProcess { public uint Id; public System.Runtime.InteropServices.ComTypes.FILETIME Started; }
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] public struct ProcessInfo {
    public UniqueProcess Process;
    [MarshalAs(UnmanagedType.ByValTStr,SizeConst=256)] public string Name;
    [MarshalAs(UnmanagedType.ByValTStr,SizeConst=64)] public string Service;
    public int Type; public uint Status; public uint Session;
    [MarshalAs(UnmanagedType.Bool)] public bool Restartable;
  }
  [DllImport("rstrtmgr.dll",CharSet=CharSet.Unicode)] static extern int RmStartSession(out uint session,int flags,string key);
  [DllImport("rstrtmgr.dll",CharSet=CharSet.Unicode)] static extern int RmRegisterResources(uint session,uint files,string[] names,uint apps,IntPtr processes,uint services,IntPtr serviceNames);
  [DllImport("rstrtmgr.dll")] static extern int RmGetList(uint session,out uint needed,ref uint count,[In,Out] ProcessInfo[] infos,ref uint reasons);
  [DllImport("rstrtmgr.dll")] static extern int RmEndSession(uint session);
  public static uint[] Owners(string[] files) {
    uint session; var code=RmStartSession(out session,0,Guid.NewGuid().ToString("N"));
    if(code!=0)throw new Exception("RESOURCE_SESSION_FAILED");
    try {
      if(RmRegisterResources(session,(uint)files.Length,files,0,IntPtr.Zero,0,IntPtr.Zero)!=0)throw new Exception("RESOURCE_REGISTER_FAILED");
      uint needed=0,count=0,reasons=0;
      code=RmGetList(session,out needed,ref count,null,ref reasons);
      if(code==0)return new uint[0];
      if(code!=234||needed>128)throw new Exception("RESOURCE_QUERY_FAILED");
      var rows=new ProcessInfo[needed];count=needed;
      if(RmGetList(session,out needed,ref count,rows,ref reasons)!=0)throw new Exception("RESOURCE_QUERY_CHANGED");
      var result=new uint[count];for(int i=0;i<count;i++)result[i]=rows[i].Process.Id;
      return result;
    }finally{RmEndSession(session);}
  }
}
'@
$request=[Console]::ReadLine() | ConvertFrom-Json
$results=@()
foreach($account in $request.accounts){
  $files=@('db_storage\message\message_0.db','db_storage\contact\contact.db') | ForEach-Object {Join-Path $account.dbPath $_} | Where-Object {Test-Path -LiteralPath $_}
  if($files.Count -eq 0){continue}
  try {
    $owners=@([XiaoyuResources]::Owners([string[]]$files))
    $verified=@()
    foreach($owner in $owners){
      $process=Get-Process -Id $owner -ErrorAction SilentlyContinue
      if($process -and $process.Path -and [string]::Equals($process.Path,$request.executable,[StringComparison]::OrdinalIgnoreCase)){$verified+=[int]$owner}
    }
    $results+=@{accountDirectory=$account.myWxid;processIds=$verified;checked=$true}
  }catch{$results+=@{accountDirectory=$account.myWxid;processIds=@();checked=$false;code='RESOURCE_QUERY_FAILED'}}
}
ConvertTo-Json -InputObject @{accounts=$results} -Depth 5 -Compress
