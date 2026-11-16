$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$version = '45.2.3'
$expected = '489cd061908e697394b004298bf5ffd345c935d10e8ca197ba819f019ab2dec0'
$runtimeRoot = Join-Path $env:LOCALAPPDATA 'Xiaoyu/DesktopRuntime'
$runtime = Join-Path $runtimeRoot ('electron-' + $version + '-user')
$log = Join-Path $runtimeRoot 'startup-error.txt'
try {
    New-Item -ItemType Directory -Path $runtimeRoot -Force | Out-Null
    $exe = Join-Path $runtime 'electron.exe'
    $marker = Join-Path $runtime '.verified-archive-sha256'
    if (-not (Test-Path -LiteralPath $exe) -or -not (Test-Path -LiteralPath $marker) -or (Get-Content -LiteralPath $marker -Raw).Trim() -ne $expected) {
        $archive = Join-Path $projectRoot ('data/electron-v' + $version + '-win32-x64-mirror.zip')
        if (-not (Test-Path -LiteralPath $archive)) { throw '缺少已校验的Electron压缩包，请在项目目录重新准备Electron运行时。' }
        if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected) { throw 'Electron压缩包校验失败，未启动。' }
        # Extract in the interactive user's normal context, outside the source
        # workspace. Do not change ACLs or disable Chromium's sandbox.
        New-Item -ItemType Directory -Path $runtime -Force | Out-Null
        Expand-Archive -LiteralPath $archive -DestinationPath $runtime -Force
        Set-Content -LiteralPath $marker -Value $expected -Encoding Ascii
    }
    Set-Location -LiteralPath $projectRoot
    $process = Start-Process -FilePath $exe -ArgumentList ('"' + $projectRoot + '"') -WorkingDirectory $projectRoot -PassThru
    if ($process.WaitForExit(5000) -and $process.ExitCode -ne 0) { throw ('Electron启动后立即退出，退出码：' + $process.ExitCode) }
} catch {
    $message = $_.Exception.Message
    if (Test-Path -LiteralPath $runtimeRoot) { Set-Content -LiteralPath $log -Value $message -Encoding UTF8 }
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.MessageBox]::Show($message + "`r`n日志：" + $log, '小鱼启动失败') | Out-Null
    exit 1
}
