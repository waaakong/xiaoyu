import asyncio
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import AsyncMock, patch

sys.path.insert(0,str(Path(__file__).resolve().parent.parent/'integrations/qzone'))
import worker
sys.path.insert(0,str(Path(__file__).resolve().parent.parent/'integrations/qzone/vendor'))

class WorkerTests(unittest.IsolatedAsyncioTestCase):
    async def test_cookie_account_mismatch_never_opens_client(self):
        with tempfile.TemporaryDirectory() as tmp, patch('qzone_bridge.client.QzoneClient') as client:
            with self.assertRaisesRegex(RuntimeError,'ACCOUNT_MISMATCH'):
                await worker.run({'operation':'bind','credentialFile':str(Path(tmp)/'secret'),'account':'100010001','cookies':'uin=o100020002; p_skey=fixture'})
            client.assert_not_called()

    async def test_windows_encrypted_bind_and_single_publish(self):
        if sys.platform!='win32':self.skipTest('DPAPI')
        from types import SimpleNamespace
        with tempfile.TemporaryDirectory() as tmp:
            file=Path(tmp)/'secret'
            client=SimpleNamespace(index=AsyncMock(return_value={}),get_visitors=AsyncMock(return_value={}),session=SimpleNamespace(cookies={'uin':'o100010001','p_skey':'fixture'}),h5_video_upload_available=lambda:True,close=AsyncMock(),publish_mood=AsyncMock(return_value={'tid':'real'}))
            with patch('qzone_bridge.client.QzoneClient',return_value=client) as factory, patch('worker.system_proxy',return_value=None):
                out=await worker.run({'operation':'bind','credentialFile':str(file),'account':'100010001','cookies':'uin=o100010001; p_skey=fixture'})
                self.assertTrue(out['bound']);self.assertNotIn(b'fixture',file.read_bytes())
                await worker.run({'operation':'publish','credentialFile':str(file),'account':'100010001','params':{'text':'fixture draft'}})
                client.publish_mood.assert_awaited_once_with('fixture draft',photos=[])
                self.assertEqual(factory.call_args.kwargs['max_retries'],1)

    def test_video_metadata_does_not_confuse_cover_with_video(self):
        self.assertEqual(worker.values_for({'cover':{'url':'x'},'video':{'sVid':'actual'}},{'vid','sVid'}),['actual'])

    def test_response_roundtrip_survives_isolated_gbk_console(self):
        import json
        text='Ciallo～(∠・ω< )⌒★ 中文与🙂'
        wire=worker.response_json({'text':text}).encode('gbk').decode('utf-8')
        self.assertEqual(json.loads(wire)['text'],text)

    async def test_video_requires_real_video_and_public_readback(self):
        from types import SimpleNamespace
        client=SimpleNamespace(login_uin=100010001,
            ensure_public_video_album=AsyncMock(return_value={'id':'album'}),
            upload_h5_video=AsyncMock(return_value=SimpleNamespace(vid='actual-video')),
            upload_h5_video_cover=AsyncMock(),
            publish_video_mood=AsyncMock(return_value={'tid':'actual-post'}),
            update_mood_visibility_public=AsyncMock(),
            detail=AsyncMock(return_value={'vid':'actual-video','who':1}))
        with tempfile.TemporaryDirectory() as tmp, patch('worker.ffmpeg_path',return_value='fixture'), patch('worker.subprocess.run',return_value=SimpleNamespace(stderr=b'Duration: 00:00:02.00')):
            video=Path(tmp)/'fixture.mp4';video.write_bytes(b'fixture')
            out=await worker.publish_video(client,{'video':str(video),'text':'video fixture'})
            self.assertTrue(out['verified'])
            self.assertEqual(client.upload_h5_video.call_args.kwargs['play_time'],2000)
            client.publish_video_mood.assert_awaited_once()
            client.detail.return_value={'cover':'image-only','who':1}
            out=await worker.publish_video(client,{'video':str(video),'text':'second isolated fixture'})
            self.assertFalse(out['verified'])

    async def test_public_resource_probe_rejects_private_or_html(self):
        from types import SimpleNamespace
        probe=AsyncMock(return_value={'readable':True,'httpStatus':206,'contentType':'video/mp4'})
        client=SimpleNamespace(login_uin=100010001,video_get_data=AsyncMock(return_value={'items':[{'vid':'actual-video','priv':0,'url':'https://photovideo.photo.qq.com/actual.mp4'}]}))
        with patch('worker.public_video_probe',probe):
            self.assertTrue((await worker.verify_video_resource(client,'actual-video'))['publicVerified'])
            client.video_get_data.return_value={'items':[{'vid':'actual-video','priv':1,'url':'https://photovideo.photo.qq.com/private.mp4'},{'vid':'other-video','priv':0,'url':'https://photovideo.photo.qq.com/other.mp4'}]}
            probe.reset_mock();self.assertFalse((await worker.verify_video_resource(client,'actual-video'))['publicVerified']);probe.assert_not_called()
            client.video_get_data.return_value={'items':[{'vid':'actual-video','priv':0,'url':'https://photovideo.photo.qq.com/actual.mp4'}]}
            probe.return_value={'readable':False,'httpStatus':200,'contentType':'text/html'}
            self.assertFalse((await worker.verify_video_resource(client,'actual-video'))['publicVerified'])

    async def test_public_probe_uses_a_fresh_client_without_authentication(self):
        from types import SimpleNamespace
        from unittest.mock import MagicMock
        public=SimpleNamespace(get=AsyncMock(return_value=SimpleNamespace(status_code=206,headers={'content-type':'video/mp4'})))
        context=MagicMock();context.__aenter__=AsyncMock(return_value=public);context.__aexit__=AsyncMock()
        with patch('httpx.AsyncClient',return_value=context) as factory, patch('worker.system_proxy',return_value=None):
            self.assertTrue((await worker.public_video_probe('https://photovideo.photo.qq.com/test.mp4'))['readable'])
            options=factory.call_args.kwargs
            self.assertEqual(options['headers'],{'Range':'bytes=0-0'})
            self.assertFalse(options['trust_env']);self.assertNotIn('cookies',options);self.assertNotIn('auth',options)

if __name__=='__main__':unittest.main()
