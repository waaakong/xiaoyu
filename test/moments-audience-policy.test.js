import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';

test('audience selection never treats editor summary as a choice, and commit requires a unique ready button',{skip:process.platform!=='win32'},()=>{
 const source=String.raw`param([string]$Source)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes
$tokens=$null;$errors=$null;$ast=[Management.Automation.Language.Parser]::ParseFile($Source,[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'parse errors'}
foreach($name in @('GetMomentPrivacyRows','GetMomentPrivacySummary','GetMomentPrivacyOptions','GetMomentPublishButton')){$f=$ast.FindAll({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name},$true)[0];Invoke-Expression $f.Extent.Text}
function Node([string]$name,[string]$class='', [string]$type='Text',[object[]]$children=@(),[bool]$enabled=$true,[bool]$off=$false){
 $n=[pscustomobject]@{Current=[pscustomobject]@{Name=$name;ClassName=$class;ControlType=[System.Windows.Automation.ControlType]::$type;IsEnabled=$enabled;IsOffscreen=$off;BoundingRectangle=[pscustomobject]@{Width=100;Height=48}};Nodes=$children}
 $n|Add-Member -MemberType ScriptMethod -Name FindAll -Value {param($scope,$condition)return $this.Nodes};return $n
}
function ItemNames($node){return @($node.Current.Name)+@($node.Nodes | ForEach-Object {$_.Current.Name})}
$public=Node '公开';$private=Node '私密'
$row=Node '谁可以看' 'mmui::PublishPrivacyView' 'Button' @($public)
$panel=Node '' '' 'Group' @($row)
if((GetMomentPrivacySummary $panel) -ne '公开'){throw 'public summary lost'}
$panel.Nodes=@((Node '谁可以看' 'unrelated-row' 'Button' @($public)))
if((GetMomentPrivacySummary $panel) -ne ''){throw 'foreign summary accepted'}
$row.Nodes=@($public,$private);$panel.Nodes=@($row)
if((GetMomentPrivacySummary $panel) -ne ''){throw 'conflicting summaries accepted'}
$script:choices=@([pscustomobject]@{e=$public})
function ByName([string]$name){return @($script:choices | Where-Object {$_.e.Current.Name -eq $name})}
if(@(GetMomentPrivacyOptions '公开').Count -ne 0){throw 'summary mistaken for action'}
$choice=Node '公开' 'mmui::PublishPrivacySelection' 'Pane'
$script:choices+=([pscustomobject]@{e=$choice})
if(@(GetMomentPrivacyOptions '公开').Count -ne 1){throw 'Qt choice fallback lost'}
$choice.Current.IsEnabled=$false
if(@(GetMomentPrivacyOptions '公开').Count -ne 0){throw 'disabled option accepted'}
$choice.Current.IsEnabled=$true;$choice.Current.IsOffscreen=$true
if(@(GetMomentPrivacyOptions '公开').Count -ne 0){throw 'hidden option accepted'}
$publish=Node '发表' '' 'Button';$caption=Node '发表'
$panel.Nodes=@($publish,$caption)
if((GetMomentPublishButton $panel) -ne $publish){throw 'publish text node selected'}
$publish.Current.IsEnabled=$false;$panel.Nodes=@($publish)
$blocked=$false;try{$null=GetMomentPublishButton $panel}catch{$blocked=$true}
if(-not $blocked){throw 'disabled commit accepted'}
$publish.Current.IsEnabled=$true;$panel.Nodes=@($publish,(Node '发表' '' 'Button'))
$blocked=$false;try{$null=GetMomentPublishButton $panel}catch{$blocked=$true}
if(-not $blocked){throw 'ambiguous commit accepted'}
Write-Output '{"audiencePolicy":true,"commitReadiness":true,"sent":false}'
`;
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'xy-audience-policy-'));
 try{const file=path.join(dir,'check.ps1');fs.writeFileSync(file,'\uFEFF'+source);const ps=path.join(process.env.SystemRoot??'C:/Windows','System32/WindowsPowerShell/v1.0/powershell.exe');const result=JSON.parse(execFileSync(ps,['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',file,'-Source',path.resolve('integrations/wechat/moments-ui.ps1')],{windowsHide:true,encoding:'utf8',timeout:20000}).trim());assert.deepEqual(result,{audiencePolicy:true,commitReadiness:true,sent:false});}finally{fs.rmSync(dir,{recursive:true,force:true});}
});
