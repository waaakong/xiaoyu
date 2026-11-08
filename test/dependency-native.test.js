import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import {execFileSync} from 'node:child_process';
test('native download bridge accepts component identifiers and never an arbitrary URL',()=>{const sent=[],window={chrome:{webview:{addEventListener(){},postMessage:m=>sent.push(JSON.parse(m))}}};vm.runInNewContext(fs.readFileSync('desktop/bridge.js','utf8'),{window,Map,setTimeout,clearTimeout,Promise});window.desktop.openDependencyPage('https://example.com');assert.equal(sent.length,0);window.desktop.openDependencyPage('astrbot');assert.deepEqual(sent,[{type:'open-dependency-page',key:'astrbot'}]);});
test('Windows prerequisite code compiles and rejects unsigned installers without running them',{skip:process.platform!=='win32'},()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'xy-prereq-'));try{const code=path.join(dir,'Check.cs'),exe=path.join(dir,'Check.exe');fs.writeFileSync(code,'using System;class Check {static void Main(string[] args){if(RuntimePrerequisites.SignedByMicrosoft(args[0]))throw new Exception("Unsigned binary accepted");Console.WriteLine("rejected; runtime detected="+RuntimePrerequisites.HasWebView());}}');const compiler=path.join(process.env.WINDIR,'Microsoft.NET/Framework64/v4.0.30319/csc.exe');execFileSync(compiler,['/nologo','/target:exe',`/out:${exe}`,'/reference:System.dll','/reference:System.Core.dll','/reference:System.Drawing.dll','/reference:System.Windows.Forms.dll',path.resolve('desktop/RuntimePrerequisites.cs'),code],{windowsHide:true,stdio:'pipe'});assert.match(execFileSync(exe,[exe],{windowsHide:true,encoding:'utf8',timeout:30000}),/rejected/);}finally{fs.rmSync(dir,{recursive:true,force:true});}});
