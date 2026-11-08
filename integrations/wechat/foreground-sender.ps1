$ErrorActionPreference='Stop'
$OutputEncoding=[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false)
[Console]::InputEncoding=New-Object System.Text.UTF8Encoding($false)
try {
  Add-Type -Path (Join-Path $PSScriptRoot 'foreground-sender.cs') -ReferencedAssemblies UIAutomationClient,UIAutomationTypes,System.Windows.Forms,System.Core,WindowsBase
  [Console]::WriteLine('{"ready":true}')
  while($null -ne ($line=[Console]::ReadLine())) {
    try {
      $body=$line | ConvertFrom-Json
      [WhaleForeground]::Attempted=$false
      $detail=$null
      $operationClock=[Diagnostics.Stopwatch]::StartNew()
      if($body.targetState) { $detail=[WhaleForeground]::TargetState($body.executable,$body.name); $ok=$true }
      elseif($body.focus) { $ok=[WhaleForeground]::Focus($body.executable) }
      elseif($body.navigate) { $ok=[WhaleForeground]::Navigate($body.executable,$body.name) }
      elseif($body.probe) { $detail=[WhaleForeground]::ProbeState($body.executable,$body.name,[bool]$body.diagnostics); $ok=$detail.Ready }
      elseif($body.favorite){ $ok=[WhaleForeground]::SendFavorite($body.executable,$body.name) }
      else { $ok=[WhaleForeground]::Send($body.executable,$body.name,$body.text) }
      [Console]::WriteLine((@{durationMs=$operationClock.ElapsedMilliseconds;accepted=$ok;attempted=[WhaleForeground]::Attempted;detail=$detail} | ConvertTo-Json -Compress))
    } catch {
      $code=if($_.Exception.ToString() -match 'FOREGROUND_[A-Z_]+'){$Matches[0]}else{'FOREGROUND_UI_UNAVAILABLE'}
      [Console]::WriteLine((@{accepted=$false;attempted=[WhaleForeground]::Attempted;code=$code}|ConvertTo-Json -Compress))
    }
  }
} catch { [Console]::WriteLine('{"ready":false}');exit 1 }
