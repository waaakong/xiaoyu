import importlib.util, pathlib, tempfile, unittest, subprocess, hashlib
import imageio_ffmpeg
ROOT=pathlib.Path(__file__).resolve().parents[1]
def load(name,file):
    spec=importlib.util.spec_from_file_location(name,ROOT/file);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module
extractor=load('video_extract','scripts/chat-video-extract.py')
reader=load('video_reader','scripts/wechat-reader-videos.py')
class VideoTests(unittest.TestCase):
    def test_real_mp4_frames_and_audio(self):
        with tempfile.TemporaryDirectory() as d:
            source=pathlib.Path(d)/'source.mp4'
            subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(),'-v','error','-f','lavfi','-i','color=c=blue:s=160x90:r=10','-f','lavfi','-i','sine=frequency=400:sample_rate=16000','-t','2','-c:v','libx264','-c:a','aac',str(source)],check=True,timeout=30)
            result=extractor.extract(str(source),str(pathlib.Path(d)/'out'),audio=True)
            self.assertEqual(len(result['frames']),6)
            self.assertTrue(pathlib.Path(result['audio']).is_file())
            self.assertTrue(all(0<f['at']<2 for f in result['frames']))
            with self.assertRaises(ValueError):extractor.extract(str(source),str(pathlib.Path(d)/'bad'),start=3,end=4)
    def test_playlist_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            p=pathlib.Path(d)/'x';p.write_text('#EXTM3U\nfile:///secret')
            with self.assertRaises(ValueError):extractor.extract(str(p),d)
    def test_video_xml_never_trusts_path_or_external_entities(self):
        md5='a'*32
        self.assertEqual(reader.video_md5('<msg><videomsg md5="'+md5+'" /></msg>'),md5)
        self.assertIsNone(reader.video_md5('<msg><videomsg md5="../secret" /></msg>'))
        self.assertIsNone(reader.video_md5('<!DOCTYPE foo><msg/>'))
    def test_cache_file_requires_exact_content_hash(self):
        with tempfile.TemporaryDirectory() as d:
            directory=pathlib.Path(d)/'msg/video';directory.mkdir(parents=True)
            raw=b'test video';md5=hashlib.md5(raw).hexdigest();file=directory/(md5+'.mp4');file.write_bytes(raw)
            self.assertEqual(reader.cached_video(d,md5),raw)
            file.write_bytes(b'wrong data')
            with self.assertRaises(ValueError):reader.cached_video(d,md5)
if __name__=='__main__':unittest.main()
