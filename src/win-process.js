import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {windowsPowerShell,windowsPowerShellEnv} from './windows-powershell.js';

const exec=promisify(execFile);
const PRELUDE="$ErrorActionPreference='Stop';[Console]::OutputEncoding=[System.Text.Encoding]::UTF8;";
const DEFAULT_MODES=['get-process','cim'];

export function processScript(mode,names){
 const list=(Array.isArray(names)?names:[names]).map(name=>String(name).replaceAll("'","''"));
 if(mode==='get-process')return PRELUDE+'$names=@('+list.map(name=>"'"+name+"'").join(',')+');$rows=@();foreach($p in @(Get-Process -Name $names -ErrorAction SilentlyContinue)){$path=$null;try{$path=$p.Path}catch{};$rows+=[pscustomobject]@{ProcessId=[int]$p.Id;ParentProcessId=$null;ExecutablePath=$path}};ConvertTo-Json -InputObject @($rows) -Compress -Depth 3';
 if(mode==='cim')return PRELUDE+'ConvertTo-Json -InputObject @((Get-CimInstance Win32_Process -Filter "'+list.map(name=>"Name='"+name+".exe'").join(' OR ')+'") | Select-Object ProcessId,ParentProcessId,ExecutablePath) -Compress -Depth 3';
 throw Error('未知的进程枚举方式: '+mode);
}

function positiveInteger(value){const number=typeof value==='number'?value:Number(value);return Number.isInteger(number)&&number>0?number:null;}

export function normalizeProcessRows(value){
 const rows=Array.isArray(value)?value:(value&&typeof value==='object'?[value]:[]);
 return rows.map(row=>{
  const pid=positiveInteger(row?.ProcessId);
  if(!pid)return null;
  const parent=positiveInteger(row?.ParentProcessId);
  const path=typeof row?.ExecutablePath==='string'&&row.ExecutablePath.trim()?row.ExecutablePath.trim():null;
  return {ProcessId:pid,ParentProcessId:parent??null,ExecutablePath:path};
 }).filter(Boolean);
}

export function parseProcessOutput(stdout){
 const text=String(stdout??'').replaceAll('\u0000','').trim();
 if(!text)return [];
 try{return normalizeProcessRows(JSON.parse(text));}catch{return [];}
}

async function runPowerShell(script,{timeout=8000}={}){
 const encoded=Buffer.from(script,'utf16le').toString('base64');
 const {stdout}=await exec(windowsPowerShell(),['-NoProfile','-NonInteractive','-EncodedCommand',encoded],{windowsHide:true,timeout,env:windowsPowerShellEnv(),maxBuffer:1<<20});
 return stdout;
}

export async function probeProcesses(names,{modes=DEFAULT_MODES,timeout=8000,run=runPowerShell,platform=process.platform,fillPaths=true}={}){
 const list=[...new Set((Array.isArray(names)?names:[names]).filter(name=>typeof name==='string'&&name.trim()))];
 if(platform!=='win32'||!list.length)return {rows:[],attempts:[]};
 const attempts=[];
 for(const mode of modes){
  try{
   const rows=parseProcessOutput(await run(processScript(mode,list),{timeout}));
   attempts.push({mode,ok:true,error:null});
   // A client that hides its image path (elevated startup) still deserves a real candidate list.
   if(!fillPaths||!rows.length||rows.some(row=>row.ExecutablePath))return {rows,attempts};
   let merged=rows;
   for(const fallback of modes.slice(modes.indexOf(mode)+1)){
    try{
     const extra=parseProcessOutput(await run(processScript(fallback,list),{timeout}));
     attempts.push({mode:fallback,ok:true,error:null});
     const byId=new Map(extra.map(row=>[row.ProcessId,row]));
     merged=merged.map(row=>row.ExecutablePath?row:(byId.get(row.ProcessId)?.ExecutablePath?{...row,ExecutablePath:byId.get(row.ProcessId).ExecutablePath}:row));
     if(merged.some(row=>row.ExecutablePath))break;
    }catch(error){attempts.push({mode:fallback,ok:false,error:String(error?.message??error)});}
   }
   return {rows:merged,attempts};
  }catch(error){attempts.push({mode,ok:false,error:String(error?.message??error)});}
 }
 return {rows:[],attempts};
}
export async function listProcesses(names,options={}){return (await probeProcesses(names,options)).rows;}

export async function processStatus(name,options={}){
 const probe=await probeProcesses([name],{fillPaths:false,...options});
 if(probe.rows.length)return 'running';
 return probe.attempts.some(attempt=>attempt.ok)?'stopped':'unknown';
}

export async function isProcessRunning(name,options={}){return await processStatus(name,options)==='running';}
