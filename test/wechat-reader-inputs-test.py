import importlib.util
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
import sys
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('inputs',ROOT/'scripts/wechat-reader-inputs.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)


class InputsTests(unittest.TestCase):
    def test_image_receipt_digest_comes_from_media_xml_not_visible_text(self):
        class Reader:
            def make_payload(self,*args):return {}
        nt=SimpleNamespace(MESSAGE_COLUMNS=('message_content',),_decode_content=lambda value:value.decode() if value else '',_message_dict=lambda *args:{'localType':3,'content':'not-a-digest'})
        upstream=SimpleNamespace(nt=nt,Reader=Reader)
        with patch.dict(sys.modules,{'wechat_voice_input':SimpleNamespace()}):
            module.install(upstream,'.')
            row={'message_content':b'<msg><img md5="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"/></msg>'}
            self.assertEqual(nt._message_dict(row,{}, {},'wx_role')['imageMd5'],'a'*32)
            self.assertNotIn('imageMd5',nt._message_dict({'message_content':b'<!DOCTYPE x><msg/>'},{},{},'wx_role'))

    def test_compressed_source_is_selected_decoded_and_forwarded_without_reading_user_text(self):
        class Reader:
            def make_payload(self,talker,message):return {'text':message.get('content','')}
        nt=SimpleNamespace(MESSAGE_COLUMNS=('message_content',),_decode_content=lambda value:'<msgsource><atuserlist>wx_role</atuserlist></msgsource>' if value==b'compressed' else '',_message_dict=lambda *args:{'content':'@display name'})
        upstream=SimpleNamespace(nt=nt,Reader=Reader)
        with patch.dict(sys.modules,{'wechat_voice_input':SimpleNamespace()}):
            module.install(upstream,'.')
            self.assertIn('source',nt.MESSAGE_COLUMNS)
            message=nt._message_dict({'source':b'compressed'}, {}, {}, 'wx_role',True)
            self.assertEqual(Reader().make_payload('group',message)['atUserIds'],['wx_role'])
            private=nt._message_dict({'source':b'compressed'}, {}, {}, 'wx_role',False)
            self.assertNotIn('msgSource',private)

    def test_only_structured_metadata_can_assert_mentions(self):
        self.assertEqual(module.mentions({'fullText':'<msgsource><atuserlist>wx_role</atuserlist></msgsource>'}),[])
        self.assertEqual(module.mentions({'msgSource':'<msgsource><atuserlist><![CDATA[wx_role,wx_other]]></atuserlist></msgsource>'}),['wx_other','wx_role'])
        self.assertEqual(module.mentions({'msgSource':'<!DOCTYPE x><msgsource><atuserlist>wx_role</atuserlist></msgsource>'}),[])

    def test_audio_needs_current_account_scope_and_reader_allowlist(self):
        with tempfile.TemporaryDirectory(dir=ROOT/'data') as directory:
            root=Path(directory);(root/'state').mkdir();(root/'config').mkdir()
            (root/'state/xiaoyu-input-grants.json').write_text(json.dumps({'version':1,'account':'wx_role','accountDirectory':'wx_role_1234','audioKeys':['wechat:private:12']}))
            file=root/'config/wechatagent.json';file.write_text(json.dumps({'wechat':{'whitelist':{'private':['12'],'groups':[]}}}))
            reader=SimpleNamespace(own_wxid='wx_role',account=root/'wx_role_1234')
            self.assertTrue(module.audio_allowed(root,'wechat:private:12','speech-recognition',reader))
            self.assertFalse(module.audio_allowed(root,'wechat:private:13','speech-recognition',reader))
            self.assertFalse(module.audio_allowed(root,'wechat:private:12','other-plugin',reader))
            reader.own_wxid='wx_other';self.assertFalse(module.audio_allowed(root,'wechat:private:12','speech-recognition',reader))
            reader.own_wxid='wx_role';file.write_text(json.dumps({'wechat':{'whitelist':{'private':[],'groups':[]}}}))
            self.assertFalse(module.audio_allowed(root,'wechat:private:12','speech-recognition',reader))


if __name__=='__main__':unittest.main()
