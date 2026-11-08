export function spokenText(text){
  return String(text).replace(/\x60{3}[\s\S]*?\x60{3}/g,'').replace(/\[([^\]]+)\]\([^)]*\)/g,'$1').replace(/https?:\/\/\S+/g,'').replace(/<[^>]*>/g,'').replace(/[*_\x60#>|]/g,'').replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu,'').replace(/[ \t]+/g,' ').replace(/\n{3,}/g,'\n\n').trim();
}
export function wantsVoice(mode,text){return mode==='only'||mode==='always'||mode==='requested'&&/(?:用语音|发(?:一条|个|段)?语音|语音(?:回复|说|回答)|^\/语音(?:\s|$))/u.test(text);}
export function wavInfo(bytes){
  if(!Buffer.isBuffer(bytes)||bytes.length<44||bytes.toString('ascii',0,4)!=='RIFF'||bytes.toString('ascii',8,12)!=='WAVE'||bytes.readUInt32LE(4)+8!==bytes.length)throw new Error('Breeze未返回完整有效WAV音频');
  let rate=0,data=0,format=0,channels=0,sampleRate=0,bits=0,blockAlign=0,dataOffset=0;for(let at=12;at+8<=bytes.length;){const name=bytes.toString('ascii',at,at+4),size=bytes.readUInt32LE(at+4),start=at+8;if(start+size>bytes.length)throw new Error('WAV音频不完整');if(name==='fmt '&&size>=16){if(format)throw Error('WAV格式块重复');format=bytes.readUInt16LE(start);channels=bytes.readUInt16LE(start+2);sampleRate=bytes.readUInt32LE(start+4);rate=bytes.readUInt32LE(start+8);blockAlign=bytes.readUInt16LE(start+12);bits=bytes.readUInt16LE(start+14);}if(name==='data'){if(dataOffset)throw Error('WAV数据块重复');data=size;dataOffset=start;}at=start+size+(size%2);}
  const seconds=data/rate;if(format!==1||channels!==1||sampleRate!==24000||bits!==16||blockAlign!==2||rate!==48000||data%2||!data||!Number.isFinite(seconds)||seconds<=0||seconds>30)throw new Error('语音需为24kHz单声道16位PCM WAV，且不超过30秒');return {seconds,sampleRate,channels,bits,dataOffset,dataBytes:data};
}
// Transport-only padding. Preserve every spoken PCM sample, including the last
// syllable; no resynthesis, speech trimming, gain adjustment or time stretching.
export function padVoiceEnd(bytes,milliseconds=1000){
  const info=wavInfo(bytes);if(!Number.isInteger(milliseconds)||milliseconds<0||milliseconds>1000)throw Error('语音尾部余量无效');
  const samples=Math.min(Math.round(info.sampleRate*milliseconds/1000),30*info.sampleRate-info.dataBytes/2),size=samples*2,end=info.dataOffset+info.dataBytes;
  if(!size)return Buffer.from(bytes);
  const output=Buffer.concat([bytes.subarray(0,end),Buffer.alloc(size),bytes.subarray(end)]);output.writeUInt32LE(output.length-8,4);output.writeUInt32LE(info.dataBytes+size,info.dataOffset-4);wavInfo(output);return output;
}

export function voiceInsteadOfText(mode,text){return mode==='only'||mode==='requested'&&wantsVoice(mode,text);}
