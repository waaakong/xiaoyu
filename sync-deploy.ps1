param([switch]$DryRun)
$ErrorActionPreference='Stop'
$src='C:\Users\WaaaKong\Desktop\file\DPF\codex-qq-companion'
$dst=Join-Path $env:APPDATA '小鱼\workspace'
$files=@(
 'src\dsh-install.js','src\gui.js','src\runtime.js','src\wechat-backend.js',
 'src\wechat-client.js','src\wechat-native-lifecycle.js','ui\engine-dashboard.js',
 'scripts\wechat-reader-setup.py','src\win-process.js',
 'scripts\start-desktop-local.ps1','打开小鱼.vbs','启动.ps1'
)
if(-not (Test-Path -LiteralPath $dst)){throw "部署副本不存在: $dst"}
$stamp=Get-Date -Format 'yyyyMMdd-HHmmss'
$backup=Join-Path $env:APPDATA ("小鱼\workspace-backup-" + $stamp)
Write-Host "源: $src" -ForegroundColor Cyan
Write-Host "目标: $dst" -ForegroundColor Cyan
Write-Host "备份: $backup" -ForegroundColor Cyan
if($DryRun){foreach($f in $files){Write-Host ("[DryRun] " + $f)}; return}
New-Item -ItemType Directory -Path $backup -Force | Out-Null
$copied=0
foreach($f in $files){
  $s=Join-Path $src $f; $d=Join-Path $dst $f
  if(-not (Test-Path -LiteralPath $s)){Write-Host "缺少源文件: $f" -ForegroundColor Yellow; continue}
  if(Test-Path -LiteralPath $d){
    $bd=Join-Path $backup $f
    New-Item -ItemType Directory -Path (Split-Path -Parent $bd) -Force | Out-Null
    Copy-Item -LiteralPath $d -Destination $bd -Force
  }
  New-Item -ItemType Directory -Path (Split-Path -Parent $d) -Force | Out-Null
  Copy-Item -LiteralPath $s -Destination $d -Force
  $copied++
}
Write-Host "已同步 $copied 个文件，旧版本已备份到 $backup" -ForegroundColor Green
Read-Host '按回车退出'