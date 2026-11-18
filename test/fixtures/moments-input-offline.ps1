param([string]$Source)
$ErrorActionPreference='Stop'
$tokens=$null;$errors=$null;$ast=[Management.Automation.Language.Parser]::ParseFile($Source,[ref]$tokens,[ref]$errors)
if($errors.Count){throw ($errors | Out-String)}
$text=[IO.File]::ReadAllText($Source)
$cs=[regex]::Match($text,"Add-Type @'\r?\n([\s\S]*?)\r?\n'@").Groups[1].Value
Add-Type -TypeDefinition $cs
$function=$ast.FindAll({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'ConvertToMomentFilePayload'},$true)[0]
Invoke-Expression $function.Extent.Text
$one='C:\图片资料\小鱼 (+)[1]{2}^%.png';$two='C:/测试 空格/第二张.jpg'
$payload=ConvertToMomentFilePayload @($one,$two)
$expected='"C:\图片资料\小鱼 (+)[1]{2}^%.png" "C:\测试 空格\第二张.jpg"'
if($payload -cne $expected){throw 'filename quoting differs'}
$events=[W]::UnicodeInputs($payload)
if($events.Length -ne $payload.Length*2){throw 'input length differs'}
for($i=0;$i -lt $payload.Length;$i++){if($events[$i*2].type -ne 1 -or $events[$i*2].data.key.scan -ne [int][char]$payload[$i] -or $events[$i*2].data.key.flags -ne 4 -or $events[$i*2+1].data.key.flags -ne 6){throw 'unicode sequence differs'}}
$expectedSize=if([IntPtr]::Size -eq 8){40}else{28}
if([Runtime.InteropServices.Marshal]::SizeOf([type][W+INPUT]) -ne $expectedSize){throw 'native input alignment differs'}
$rejected=0;foreach($bad in @('',('C:\a'+[char]10+'b.png'),'C:\a"b.png')){try{[void](ConvertToMomentFilePayload @($bad))}catch{$rejected++}}
if($rejected -ne 3){throw 'invalid paths not rejected'}

Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes
$countFunction=$ast.FindAll({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'GetMomentMediaPreviewCount'},$true)[0]
Invoke-Expression $countFunction.Extent.Text
function FakeControl([string]$class,[string]$type='ListItem',[bool]$off=$false){return [pscustomobject]@{Current=[pscustomobject]@{ClassName=$class;ControlType=[System.Windows.Automation.ControlType]::$type;IsOffscreen=$off;BoundingRectangle=[pscustomobject]@{Width=96;Height=96}}}}
function CountMedia($nodes){$p=[pscustomobject]@{Elements=@($nodes)};$p|Add-Member -MemberType ScriptMethod -Name FindAll -Value {param($scope,$condition)return $this.Elements};return (GetMomentMediaPreviewCount $p)}
$cell=FakeControl 'mmui::PublishImageGridCell';$add=FakeControl 'mmui::PublishImageAddGridCell';$nested=FakeControl 'NestedImage' 'Image'
if((CountMedia @($cell,$cell,$add,$nested)) -ne 2){throw 'grid/add/nested nodes counted incorrectly'}
if((CountMedia @($add,$nested)) -ne 0){throw 'add cell accepted as an image'}
if((CountMedia @((FakeControl 'mmui::PublishImageGridCell' 'ListItem' $true),$add)) -ne 0){throw 'offscreen image accepted'}
if((CountMedia @($nested)) -ne 1){throw 'legacy Image control fallback lost'}
Write-Output '{"parserErrors":0,"unicodeInput":true,"nativeInputAlignment":true,"pathQuoting":true,"invalidPathsRejected":3,"mediaCountPolicy":true,"sentInput":false}'
