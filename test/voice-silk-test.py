import importlib.util
import io
import struct
import unittest
import wave
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('voice_silk', ROOT/'scripts/voice-silk.py')
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)


def wav(frames=24000, rate=24000):
    out = io.BytesIO()
    with wave.open(out, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(bytes(frames*2))
    return out.getvalue()


class CodecTests(unittest.TestCase):
    def test_real_codec_roundtrip(self):
        import inspect
        import pysilk
        silk, duration = worker.encode(wav())
        self.assertEqual(duration, 1000)
        if 'output' in inspect.signature(pysilk.decode).parameters:
            decoded = io.BytesIO()
            pysilk.decode(io.BytesIO(silk), decoded, 24000)
            self.assertEqual(len(decoded.getvalue()), 48000)
        else:
            self.assertEqual(len(pysilk.decode(silk)), 48000)

    def test_partial_frame_padding(self):
        self.assertEqual(worker.encode(wav(24100))[1], 1020)

    def test_wrong_rate_and_duration(self):
        for data in (wav(rate=16000), wav(720001)):
            with self.assertRaises(ValueError):
                worker.encode(data)

    def test_truncated_packets(self):
        for data in (b'not silk', b'\x02#!SILK_V3', b'\x02#!SILK_V3\x02\x00x'):
            with self.assertRaises(ValueError):
                worker.inspect_silk(data)


if __name__ == '__main__':
    unittest.main()
