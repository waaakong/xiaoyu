"""Bounded local video sampling. No network protocols or model calls."""
import base64, json, pathlib, re, subprocess, sys
import imageio_ffmpeg

def extract(source, output, start=0, end=None, audio=False):
    source, output = pathlib.Path(source), pathlib.Path(output)
    if not source.is_file() or not 0 < source.stat().st_size <= 50*1024*1024:
        raise ValueError('视频超过50MB或文件为空，请压缩后重新发送')
    header=source.read_bytes()[:32]
    if not (header[4:8]==b'ftyp' or header.startswith(b'\x1a\x45\xdf\xa3')):
        raise ValueError('仅支持实际MP4/MOV/WebM视频，不支持播放列表')
    exe = imageio_ffmpeg.get_ffmpeg_exe()
    flags = dict(stdin=subprocess.DEVNULL, creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0), timeout=20)
    base = [exe,'-nostdin','-protocol_whitelist','file,pipe','-threads','1']
    probe = subprocess.run(base+['-i',str(source)],stdout=subprocess.DEVNULL,stderr=subprocess.PIPE,**flags)
    match = re.search(rb'Duration: (\d+):(\d+):([\d.]+)',probe.stderr)
    if not match: raise ValueError('无法读取视频时长，不依据封面猜测')
    h,m,s=map(float,match.groups()); duration=h*3600+m*60+s
    stop=duration if end is None else min(end,duration)
    if not 0 <= start < stop or stop-start > 180:
        raise ValueError('视频超过3分钟，请随视频注明“视频片段 0-60秒”等范围（最多180秒）')
    output.mkdir(parents=True,exist_ok=True)
    frames=[]
    for i in range(6):
        at=min(start+(stop-start)*((i+.5)/6),max(start,stop-.25))
        target=output/f'{i}.jpg'
        subprocess.run(base+['-v','error','-ss',str(at),'-i',str(source),'-frames:v','1','-vf',"scale=960:960:force_original_aspect_ratio=decrease",'-q:v','4','-y',str(target)],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,check=True,**flags)
        frames.append({'at':round(at,2),'base64':base64.b64encode(target.read_bytes()).decode()})
    audio_file=None
    if audio:
        target=output/'audio.wav'
        result=subprocess.run(base+['-v','error','-ss',str(start),'-i',str(source),'-t',str(min(60,stop-start)),'-vn','-ac','1','-ar','16000','-y',str(target)],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,**flags)
        if result.returncode==0 and target.is_file() and target.stat().st_size<=10*1024*1024:audio_file=str(target)
    return {'duration':duration,'start':start,'end':stop,'frames':frames,'audio':audio_file}

if __name__=='__main__':
    try:
        request=json.loads(sys.stdin.read())
        print(json.dumps(extract(**request)))
    except Exception as error:
        print(json.dumps({'error':str(error)[:300] if isinstance(error,ValueError) else '本地视频解码未完成，请检查格式或依赖环境'}));sys.exit(1)
