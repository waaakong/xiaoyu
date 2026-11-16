import test from 'node:test';
import assert from 'node:assert/strict';
import {probeProcesses,processStatus,isProcessRunning,parseProcessOutput,processScript} from '../src/win-process.js';

const row=(id,extra={})=>({ProcessId:id,ParentProcessId:null,ExecutablePath:'C:\\Program Files\\Tencent\\Weixin\\Weixin.exe',...extra});

test('process discovery falls back when the preferred interface is denied',async()=>{
 const seen=[];
 const run=async(script)=>{seen.push(script);if(seen.length===1)throw Error('拒绝访问');return JSON.stringify([row(42)]);};
 const probe=await probeProcesses(['Weixin'],{run,platform:'win32'});
 assert.equal(probe.rows.length,1);assert.equal(probe.rows[0].ProcessId,42);
 assert.deepEqual(probe.attempts.map(a=>a.ok),[false,true]);assert.match(probe.attempts[0].error,/拒绝访问/);
 assert.match(seen[0],/Get-Process/);assert.match(seen[1],/Get-CimInstance/);
});

test('process status distinguishes running from denied enumeration',async()=>{
 const running=async()=>JSON.stringify(row(7));
 const empty=async()=>'';
 const denied=async()=>{throw Error('拒绝访问');};
 assert.equal(await processStatus('Weixin',{run:running,platform:'win32'}),'running');
 assert.equal(await isProcessRunning('Weixin',{run:running,platform:'win32'}),true);
 assert.equal(await processStatus('Weixin',{run:empty,platform:'win32'}),'stopped');
 assert.equal(await isProcessRunning('Weixin',{run:empty,platform:'win32'}),false);
 assert.equal(await processStatus('Weixin',{run:denied,platform:'win32'}),'unknown');
 assert.equal(await isProcessRunning('Weixin',{run:denied,platform:'win32'}),false);
});

test('process output parsing tolerates single objects, noise and invalid ids',async()=>{
 assert.deepEqual(parseProcessOutput(''),[]);
 assert.deepEqual(parseProcessOutput('不是JSON'),[]);
 assert.deepEqual(parseProcessOutput(JSON.stringify(row(5,{ParentProcessId:3}))),[{ProcessId:5,ParentProcessId:3,ExecutablePath:'C:\\Program Files\\Tencent\\Weixin\\Weixin.exe'}]);
 assert.equal(parseProcessOutput(JSON.stringify([{ProcessId:5},{ProcessId:0},{ProcessId:-1},{ProcessId:'x'},null])).length,1);
 assert.equal(parseProcessOutput(JSON.stringify([{ProcessId:5,ExecutablePath:'   '}]))[0].ExecutablePath,null);
});

test('non-windows hosts never spawn a process query',async()=>{
 let calls=0;
 const probe=await probeProcesses(['Weixin'],{run:async()=>{calls++;return '';},platform:'linux'});
 assert.deepEqual(probe,{rows:[],attempts:[]});assert.equal(calls,0);
 assert.equal(await processStatus('Weixin',{run:async()=>{calls++;return '';},platform:'linux'}),'unknown');
 assert.equal(calls,0);
});

test('hidden image paths are recovered from the next source',async()=>{
 const scripts=[];
 const run=async(script)=>{scripts.push(script);return scripts.length===1?JSON.stringify(row(9,{ExecutablePath:null})):JSON.stringify(row(9));};
 const probe=await probeProcesses(['Weixin'],{run,platform:'win32'});
 assert.equal(probe.rows[0].ExecutablePath,'C:\\Program Files\\Tencent\\Weixin\\Weixin.exe');
 assert.deepEqual(probe.attempts.map(a=>a.mode),['get-process','cim']);
 const calls=[];
 assert.equal(await processStatus('Weixin',{run:async(script)=>{calls.push(script);return JSON.stringify(row(9,{ExecutablePath:null}));},platform:'win32'}),'running');
 assert.equal(calls.length,1);
});

test('process scripts filter by the requested executable names',async()=>{
 assert.match(processScript('get-process',['Weixin']),/\$names=@\('Weixin'\)/);
 const cim=processScript('cim',['Weixin','WeChat']);
 assert.match(cim,/Name='Weixin\.exe' OR Name='WeChat\.exe'/);
 assert.throws(()=>processScript('unknown',['Weixin']),/未知的进程枚举方式/);
});
