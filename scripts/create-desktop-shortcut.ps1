$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$package = Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json
$launcher = Join-Path $projectRoot ('dist/xiaoyu-' + $package.version + '-win-x64/小鱼.exe')
if (-not (Test-Path -LiteralPath $launcher)) { throw '请先运行 npm run package:windows' }
$shell = New-Object -ComObject WScript.Shell
$desktopDirectory = [Environment]::GetFolderPath('Desktop')
$shortcutPath = Join-Path $desktopDirectory '小鱼.lnk'
if (Test-Path -LiteralPath $shortcutPath) {
    $shortcutPath = Join-Path $desktopDirectory '小鱼 QQ Companion.lnk'
    if (Test-Path -LiteralPath $shortcutPath) { throw '桌面已有两个同名快捷方式，未覆盖。' }
}
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $launcher
$shortcut.Arguments = '--project "' + $projectRoot + '"'
$shortcut.WorkingDirectory = $projectRoot
$shortcut.IconLocation = $launcher + ',0'
$shortcut.Description = '小鱼桌面端，使用当前项目配置与记忆'
$shortcut.Save()
Write-Output $shortcutPath
