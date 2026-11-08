import importlib.util
import pathlib
import unittest
import tempfile

spec = importlib.util.spec_from_file_location("speech_worker", pathlib.Path(__file__).resolve().parents[1] / "scripts" / "speech-worker.py")
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)

class BrowserAudioFormat(unittest.TestCase):
    def test_media_recorder_webm_routes_to_matroska_decoder(self):
        self.assertEqual(worker.audio_format(bytes.fromhex("1a45dfa3") + b"\x87\x42\x82\x84webm"), "matroska")

    def test_arbitrary_ebml_or_unknown_payload_is_rejected(self):
        for data in (bytes.fromhex("1a45dfa3") + b"unknown", b"not an audio file"):
            with self.assertRaises(ValueError):
                worker.audio_format(data)

    def test_existing_wav_and_ogg_still_work(self):
        self.assertEqual(worker.audio_format(b"RIFF1234WAVE"), "wav")
        self.assertEqual(worker.audio_format(b"OggS"), "ogg")


class AccountCacheBoundary(unittest.TestCase):
    def test_shared_models_accept_only_the_selected_accounts_cache(self):
        with tempfile.TemporaryDirectory() as temporary:
            base = pathlib.Path(temporary)
            model = base / "speech" / "model"
            cache = base / "wechat" / "account_a" / "speech" / "cache"
            other = base / "wechat" / "account_b" / "speech" / "cache"
            for directory in (model, cache, other):
                directory.mkdir(parents=True)
            own = cache / "job-123456" / "input.audio"
            own.parent.mkdir()
            own.write_bytes(b"audio")
            foreign = other / "input.audio"
            foreign.write_bytes(b"audio")
            sample = model / "sample.mp3"
            sample.write_bytes(b"audio")
            self.assertEqual(worker.checked_source(own, cache, model), own.resolve())
            for source in (foreign, sample):
                with self.assertRaisesRegex(ValueError, "本机临时目录"):
                    worker.checked_source(source, cache, model)
            self.assertEqual(worker.checked_source(sample, cache, model, sample=True), sample.resolve())
            with self.assertRaises(ValueError):
                worker.checked_source(foreign, cache, model, sample=True)

    def test_parent_traversal_and_sibling_prefix_do_not_expand_the_cache(self):
        with tempfile.TemporaryDirectory() as temporary:
            base = pathlib.Path(temporary)
            cache = base / "cache"
            cache.mkdir()
            other = base / "cache-other"
            other.mkdir()
            target = other / "input.audio"
            target.write_bytes(b"audio")
            with self.assertRaises(ValueError):
                worker.checked_source(cache / ".." / "cache-other" / "input.audio", cache, base)

if __name__ == "__main__":
    unittest.main()
