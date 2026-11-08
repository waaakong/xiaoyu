"""Bounded WAV-to-Tencent-SILK worker. Local files only; never sends audio."""
import argparse
import io
import inspect
import json
from pathlib import Path
import struct
import wave


def inspect_silk(data):
    if not data.startswith(b'\x02#!SILK_V3'):
        raise ValueError('Tencent SILK header required')
    at, packets = 10, 0
    while at < len(data):
        if at + 2 > len(data):
            raise ValueError('Truncated SILK packet')
        size = struct.unpack_from('<h', data, at)[0]
        at += 2
        if size <= 0 or size > 1024 or at + size > len(data):
            raise ValueError('Invalid SILK packet length')
        at += size
        packets += 1
    if not 1 <= packets <= 1500:
        raise ValueError('Voice must be at most 30 seconds')
    return packets * 20


def encode(data):
    import pysilk
    if len(data) > 1500000:
        raise ValueError('WAV too large')
    with wave.open(io.BytesIO(data), 'rb') as source:
        if source.getnchannels() != 1 or source.getframerate() != 24000 or source.getsampwidth() != 2 or source.getcomptype() != 'NONE':
            raise ValueError('Expected mono 24kHz signed 16-bit PCM')
        frames = source.getnframes()
        if not 1 <= frames <= 720000:
            raise ValueError('Voice must be at most 30 seconds')
        pcm = source.readframes(frames)
        if len(pcm) != frames * 2:
            raise ValueError('Truncated WAV')
    # SILK packets are 20 ms. Pad only the final partial frame, at most 19.96 ms.
    pcm += bytes((-len(pcm)) % 960)
    if 'output' in inspect.signature(pysilk.encode).parameters:
        output = io.BytesIO()
        pysilk.encode(io.BytesIO(pcm), output, 24000, 24000, complexity=2, tencent=True)
        silk = output.getvalue()
    else:
        silk = pysilk.encode(pcm, data_rate=24000, sample_rate=24000)
    duration = inspect_silk(silk)
    if duration != len(pcm) // 48:
        raise ValueError('Encoded voice duration mismatch')
    return silk, duration


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    source, target = Path(args.input), Path(args.output)
    if source.stat().st_size > 1500000:
        raise ValueError('WAV too large')
    silk, duration = encode(source.read_bytes())
    with target.open('xb') as file:
        file.write(silk)
    print(json.dumps({'milliseconds': duration, 'bytes': len(silk), 'codec': 'tencent-silk-v3'}))


if __name__ == '__main__':
    main()
