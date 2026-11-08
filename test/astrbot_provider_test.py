import asyncio
import pathlib
import sys
import unittest
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / 'integrations' / 'astrbot'))
from xiaoyu_provider import XiaoyuCodexProvider, request_id, pipeline_owner, reply_owner, coordinate_memory_plugins, fit_model_history
from astrbot.core.platform.astr_message_event import current_message_event


class ProviderTests(unittest.IsolatedAsyncioTestCase):
    def test_history_budget_preserves_latest_and_mandatory_input(self):
        messages = [{'role':'user' if i%2 else 'assistant', 'content':str(i)} for i in range(100)]
        self.assertEqual(fit_model_history('人设', '当前问题', messages), messages[-40:])
        history = fit_model_history('人'*13000, '问'*2000, [{'role':'user','content':'🙂'*20000}, {'role':'assistant','content':'最新'}])
        self.assertEqual(history[-1]['content'], '最新')
        self.assertLessEqual(sum(len(m['content'].encode('utf-16-le'))//2 for m in history), 17000)
        self.assertIn('较早内容已省略', history[0]['content'])
        with self.assertRaisesRegex(RuntimeError, '系统提示32001'):
            fit_model_history('a'*32001, '', [])

    async def test_memory_coordination_is_per_event(self):
        plugin = lambda name: SimpleNamespace(name=name, activated=True)
        stars = {'plugins.astrbot_plugin_angel_memory.main': plugin('astrbot_plugin_angel_memory'), 'plugins.chat_plus.main': plugin('chat_plus')}
        original = [SimpleNamespace(handler_module_path=key) for key in stars]
        data = {'activated_handlers': original}
        event = SimpleNamespace(message_obj=SimpleNamespace(raw_message={'xiaoyu_request_id':'a'*8+'-aaaa-aaaa-aaaa-'+'a'*12}), plugins_name=None, get_extra=lambda key: data.get(key), set_extra=lambda key,value:data.update({key:value}))
        coordinate_memory_plugins(event,stars)
        self.assertEqual(event.plugins_name,['chat_plus'])
        self.assertEqual(len(data['activated_handlers']),1)
        self.assertTrue(stars['plugins.astrbot_plugin_angel_memory.main'].activated)
        event.message_obj.raw_message={}
        event.plugins_name=None
        coordinate_memory_plugins(event,stars)
        self.assertIsNone(event.plugins_name)
        event.message_obj.raw_message={'xiaoyu_lease_id':'b'*8+'-bbbb-bbbb-bbbb-'+'b'*12}
        data['activated_handlers']=original
        coordinate_memory_plugins(event,stars)
        self.assertEqual(event.plugins_name,['chat_plus'])
        self.assertIsNone(request_id(event))  # Command leases grant no model access.

    async def test_requests_are_task_local_and_without_lease_fail(self):
        provider = XiaoyuCodexProvider({'id': 'test', 'type': 'xiaoyu_local_codex'}, {})
        await self.assertRaisesAsync(provider)
        calls = []
        async def fake(route, payload):
            await asyncio.sleep(0)
            calls.append(payload)
            return {'reply': payload['trace']}
        async def work(trace, final):
            event = SimpleNamespace(message_obj=SimpleNamespace(raw_message={'xiaoyu_request_id': trace}), get_extra=lambda name: final)
            token = current_message_event.set(event)
            owner_token=pipeline_owner.set(asyncio.current_task())
            reply_token=reply_owner.set(asyncio.current_task() if final else None)
            try:
                with self.assertRaisesRegex(RuntimeError,'后台派生'):
                    await asyncio.create_task(provider.text_chat(prompt='background must fail'))
                history = [{'role':'user' if i%2 else 'assistant','content':f'turn {i}'} for i in range(90)]
                return (await provider.text_chat(prompt='hello', contexts=history, system_prompt='人'*13000)).completion_text
            finally:
                pipeline_owner.reset(owner_token)
                reply_owner.reset(reply_token)
                current_message_event.reset(token)
        a,b='a'*8+'-aaaa-aaaa-aaaa-'+'a'*12,'b'*8+'-bbbb-bbbb-bbbb-'+'b'*12
        with patch('xiaoyu_provider.bridge_request', fake):
            self.assertEqual(await asyncio.gather(work(a, True),work(b, False)),[a,b])
        self.assertEqual({x['purpose'] for x in calls},{'reply','aux'})
        self.assertTrue(all(len(x['contexts']) == 40 and x['contexts'][-1]['content'] == 'turn 89' for x in calls))
        self.assertTrue(all(x['system'] == '人'*13000 and x['prompt'] == 'hello' for x in calls))
        self.assertIsNone(request_id(SimpleNamespace(message_obj=SimpleNamespace(raw_message={'xiaoyu_request_id': 'not a trace'}))))

    async def assertRaisesAsync(self,provider):
        with self.assertRaisesRegex(RuntimeError,'授权'):
            await provider.text_chat(prompt='hello')


if __name__=='__main__':unittest.main()
