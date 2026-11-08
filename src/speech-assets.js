import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const rev='4e95991ddb34c70e9b94f026d62ac82a9d941ae1';
export const SPEECH_PACKAGES=['funasr-onnx==0.4.6','onnxruntime==1.23.2','imageio-ffmpeg==0.8.1','pysilk-mod==1.6.4','librosa==0.11.0'];
const asset=(name,size,sha256,repo='iic/SenseVoiceSmall-onnx',revision=rev,remote=name)=>({name,size,sha256,url:`https://www.modelscope.cn/api/v1/models/${repo}/repo?Revision=${revision}&FilePath=${encodeURIComponent(remote)}`});
export const SPEECH_ASSETS=[
  asset('model_quant.onnx',241216270,'21dc965f689a78d1604717bf561e40d5a236087c85a95584567835750549e822'),
  asset('am.mvn',11203,'29b3c740a2c0cfc6b308126d31d7f265fa2be74f3bb095cd2f143ea970896ae5'),
  asset('config.yaml',1855,'f71e239ba36705564b5bf2d2ffd07eece07b8e3f2bbf6d2c99d8df856339ac19'),
  asset('tokens.json',352064,'a2594fc1474e78973149cba8cd1f603ebed8c39c7decb470631f66e70ce58e97'),
  asset('chn_jpn_yue_eng_ko_spectok.bpe.model',377341,'aa87f86064c3730d799ddf7af3c04659151102cba548bce325cf06ba4da4e6a8','iic/SenseVoiceSmall','70514a3da51f1160f51d18449dab6128bbd4928b'),
  asset('sample.mp3',44973,'0e64de19e4ff9a02e682955c9112f32d2317cfdbb5bc2f3504664044c993f195','iic/SenseVoiceSmall','6709c4c1685db2a3d5cb9a7a27a09872c4c5e7e6','example/zh.mp3')
];
export const SPEECH_SIGNATURE=crypto.createHash('sha256').update(JSON.stringify({packages:SPEECH_PACKAGES,assets:SPEECH_ASSETS})).digest('hex');
export const speechModel=base=>path.join(base,'speech','model');
export function speakerForModel(speaker){try{const data=JSON.parse(speaker);if(data.input==='voice'){const {speech,...identity}=data;return JSON.stringify(identity);}}catch{}return speaker;}
export function speechInstalled(base){try{return fs.existsSync(path.join(base,'speech-env','Scripts','python.exe'))&&JSON.parse(fs.readFileSync(path.join(base,'speech','installed.json'),'utf8')).signature===SPEECH_SIGNATURE&&SPEECH_ASSETS.every(a=>fs.statSync(path.join(speechModel(base),a.name)).size===a.size);}catch{return false;}}
export const speechHints=result=>result?`本轮输入来自语音转写，可能有识别误差。以下为本机模型估计的语气线索，不是用户原话，不代表真实心情，不可作为长期记忆事实；仅温和参考，不直接给用户贴情绪标签：${JSON.stringify({emotion:result.emotion??'unknown',events:result.events??[],language:result.language??'unknown'})}`:'';
