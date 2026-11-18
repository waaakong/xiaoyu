import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {execFileSync} from 'node:child_process';

test('Windows file picker input compiles and preserves quoted Unicode filenames without sending input', {skip:process.platform!=='win32'},()=>{
 const ps=path.join(process.env.SystemRoot??'C:/Windows','System32/WindowsPowerShell/v1.0/powershell.exe');
 const output=execFileSync(ps,['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.resolve('test/fixtures/moments-input-offline.ps1'),'-Source',path.resolve('integrations/wechat/moments-ui.ps1')],{encoding:'utf8',timeout:20000,windowsHide:true});
 const result=JSON.parse(output.trim());
 assert.equal(result.parserErrors,0);
 assert.equal(result.unicodeInput,true);
 assert.equal(result.nativeInputAlignment,true);
 assert.equal(result.pathQuoting,true);
 assert.equal(result.invalidPathsRejected,3);
 assert.equal(result.mediaCountPolicy,true);
 assert.equal(result.sentInput,false);
});
