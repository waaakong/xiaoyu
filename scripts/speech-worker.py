"""Local-only SenseVoice JSONL worker. Never downloads or exports model weights."""
import argparse
import contextlib
import json
import pathlib
import re
import struct
import subprocess
import sys
import tempfile
import time
import wave


def tags(raw):
    found = re.findall(r"<\|([^|]+)\|>", raw)
    emotions = {"NEUTRAL": "neutral", "HAPPY": "happy", "SAD": "sad", "ANGRY": "angry", "FEARFUL": "fearful", "DISGUSTED": "disgusted", "SURPRISED": "surprised"}
    affect = list(dict.fromkeys(emotions[t] for t in found if t in emotions))
    events = list(dict.fromkeys(t.lower() for t in found if t in {"Laughter", "Crying", "Applause", "Music", "Speech", "BGM", "Breath", "Cough", "Sneeze"}))
    return {"text": re.sub(r"<\|[^|]+\|>", "", raw).strip(), "emotion": affect[0] if len(affect) == 1 else "unknown", "events": events, "language": next((t for t in found if t in {"zh", "en", "ja", "ko", "yue"}), "unknown"), "tagged": bool(found)}


def audio_format(data):
    if data.startswith(b"\x02#!SILK_V3") or data.startswith(b"#!SILK_V3"):
        return "silk"
    if data[:4] == b"RIFF" and data[8:12] == b"WAVE":
        return "wav"
    if data.startswith(b"\x1a\x45\xdf\xa3") and b"webm" in data[:4096]:
        return "matroska"  # Chromium MediaRecorder WebM/Opus; FFmpeg validates the container.
    if data.startswith(b"OggS"):
        return "ogg"
    if data.startswith(b"fLaC"):
        return "flac"
    if data.startswith(b"#!AMR"):
        return "amr"
    if data[4:8] == b"ftyp":
        return "mov"
    if data.startswith(b"ID3") or len(data) > 1 and data[0] == 255 and data[1] & 224 == 224:
        return "mp3"
    raise ValueError("不支持的音频格式")


def silk_wav(data):
    import pysilk
    encoded = data if data.startswith(b"\x02") else b"\x02" + data
    if data.startswith(b"\x02"):
        data = data[1:]
    offset, packets = 9, 0
    while offset < len(data):
        if offset + 2 > len(data):
            raise ValueError("SILK帧截断")
        size = struct.unpack_from("<h", data, offset)[0]
        offset += 2
        if size == -1:
            break
        if size < 0 or size > 2500 or offset + size > len(data):
            raise ValueError("SILK帧无效")
        offset += size
        packets += 1
        if packets > 3000:
            raise ValueError("语音超过60秒")
    if not packets:
        raise ValueError("语音为空")
    return pysilk.decode(encoded, to_wav=True)


def checked_source(source, cache_dir, model_dir, sample=False):
    source = pathlib.Path(source).resolve(strict=True)
    allowed = pathlib.Path(cache_dir).resolve()
    if not source.is_relative_to(allowed) and not (sample and source == pathlib.Path(model_dir).resolve() / "sample.mp3"):
        raise ValueError("音频不在本机临时目录内")
    return source


class Recognizer:
    def __init__(self, base, cache_base=None):
        self.base = pathlib.Path(base).resolve()
        self.cache_dir = pathlib.Path(cache_base or base).resolve() / "speech" / "cache"
        self.model_dir = self.base / "speech" / "model"
        for name in ["model_quant.onnx", "config.yaml", "am.mvn", "chn_jpn_yue_eng_ko_spectok.bpe.model"]:
            if not (self.model_dir / name).is_file():
                raise ValueError("请先在依赖中心完整准备语音模型")
        with contextlib.redirect_stdout(sys.stderr):
            from funasr_onnx import SenseVoiceSmall
            self.model = SenseVoiceSmall(str(self.model_dir), batch_size=1, quantize=True, intra_op_num_threads=4, device_id="-1")

    def transcribe(self, source, sample=False):
        import imageio_ffmpeg
        import numpy as np
        source = checked_source(source, self.cache_dir, self.model_dir, sample)
        if not 0 < source.stat().st_size <= 10 * 1024 * 1024:
            raise ValueError("音频大小须在10MB以内")
        data = source.read_bytes()
        fmt = audio_format(data)
        start = time.monotonic()
        with tempfile.TemporaryDirectory(prefix="decode-", dir=source.parent) as temporary:
            target = pathlib.Path(temporary) / "audio.wav"
            if fmt == "silk":
                decoded = pathlib.Path(temporary) / "silk.wav"
                decoded.write_bytes(silk_wav(data))
                source, fmt = decoded, "wav"
            subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), "-nostdin", "-v", "error", "-protocol_whitelist", "file,pipe", "-f", fmt, "-i", str(source), "-vn", "-ac", "1", "-ar", "16000", "-t", "61", "-c:a", "pcm_s16le", "-f", "wav", str(target)], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=30, check=True, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
            with wave.open(str(target), "rb") as audio:
                seconds = audio.getnframes() / audio.getframerate()
                if not 0.1 <= seconds <= 60:
                    raise ValueError("语音须在0.1至60秒以内")
                waveform = np.frombuffer(audio.readframes(audio.getnframes()), dtype="<i2").astype(np.float32) / 32768
            if float(np.sqrt(np.mean(waveform ** 2))) < 0.0001:
                raise ValueError("未检测到有效声音")
            decoded_at = time.monotonic()
            with contextlib.redirect_stdout(sys.stderr):
                result = self.model(waveform, language="auto", textnorm="withitn")
            parsed = tags(result[0] if result else "")
            if not parsed["text"] or len(parsed["text"]) > 4000:
                raise ValueError("未识别到有效语音文字")
            return {**parsed, "seconds": round(seconds, 2), "decodeMs": round((decoded_at-start)*1000), "inferenceMs": round((time.monotonic()-decoded_at)*1000)}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", required=True)
    parser.add_argument("--cache-base", help="Per-account runtime directory; model environment remains shared")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    recognizer = Recognizer(args.base, args.cache_base)
    if args.self_test:
        import imageio_ffmpeg
        import pysilk
        result = recognizer.transcribe(recognizer.model_dir / "sample.mp3", sample=True)
        cache = recognizer.cache_dir
        cache.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix="selftest-", dir=cache) as temporary:
            pcm = subprocess.check_output([imageio_ffmpeg.get_ffmpeg_exe(), "-nostdin", "-v", "error", "-i", str(recognizer.model_dir / "sample.mp3"), "-ac", "1", "-ar", "24000", "-f", "s16le", "pipe:1"], timeout=30, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
            silk = pathlib.Path(temporary) / "sample.silk"
            silk.write_bytes(pysilk.encode(pcm))
            silk_result = recognizer.transcribe(silk)
            if not silk_result["text"]:
                raise ValueError("SILK自检失败")
        print(json.dumps({"ok": True, **result, "silkVerified": True}, ensure_ascii=False), flush=True)
        return
    print(json.dumps({"ready": True}), flush=True)
    for line in sys.stdin:
        request = {}
        try:
            if len(line) > 8192:
                raise ValueError("请求过大")
            request = json.loads(line)
            result = recognizer.transcribe(recognizer.model_dir / "sample.mp3", sample=True) if request.get("op") == "probe" else recognizer.transcribe(request["path"])
            response = {"id": request["id"], "ok": True, **result}
        except Exception as error:
            # Do not echo filenames, decoder output, or private speech into logs.
            response = {"id": request.get("id"), "ok": False, "error": str(error) if isinstance(error, ValueError) else "音频解码或识别失败"}
        print(json.dumps(response, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
