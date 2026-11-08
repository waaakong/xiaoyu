"""Offline fixture only. Not installed in the user's live AstrBot."""
import sys
import os
import json
import pathlib
import zipfile
import asyncio
from astrbot.api.star import Star
from astrbot.api.event import filter

class EnhancementFixture(Star):
    @filter.event_message_type(filter.EventMessageType.ALL, priority=sys.maxsize)
    async def auxiliary(self,event):
        if '辅助' in event.message_str:
            await self.verify_installs()
            provider=self.context.get_using_provider()
            async def background():
                try:
                    await provider.text_chat(prompt='forbidden background')
                except RuntimeError as exc:
                    return '后台派生' in str(exc)
                return False
            if not await asyncio.create_task(background()):raise RuntimeError('Background inherited a model lease')
            result=await provider.text_chat(prompt='只回复yes',system_prompt='你是判断器')
            if result.completion_text!='yes':raise RuntimeError('Auxiliary provider result mismatch')

    async def verify_installs(self):
        root=pathlib.Path(os.environ['ASTRBOT_ROOT'])
        wheel=root/'xiaoyu_install_fixture-1.0-py3-none-any.whl'
        with zipfile.ZipFile(wheel,'w') as archive:
            archive.writestr('xiaoyu_install_fixture.py','value=1\n')
            prefix='xiaoyu_install_fixture-1.0.dist-info/'
            archive.writestr(prefix+'METADATA','Metadata-Version: 2.1\nName: xiaoyu-install-fixture\nVersion: 1.0\n')
            archive.writestr(prefix+'WHEEL','Wheel-Version: 1.0\nGenerator: fixture\nRoot-Is-Purelib: true\nTag: py3-none-any\n')
            archive.writestr(prefix+'RECORD','')
        manager=self.context._star_manager
        passed=[]
        for index in [1,2,0,3]:
            name=f'xiaoyu_install_test_{index}'
            file=root/f'{name}.zip'
            with zipfile.ZipFile(file,'w') as archive:
                archive.writestr('metadata.yaml',f'name: {name}\ndesc: Offline installation fixture\nversion: 1.0.0\nauthor: Xiaoyu\n')
                archive.writestr('main.py','from astrbot.api.star import Star\nclass Fixture(Star):pass\n')
                archive.writestr('requirements.txt',str(wheel) if index else 'xiaoyu-absent-fixture-zz==0.0')
            failed=False
            try:
                await manager.install_plugin_from_file(str(file))
            except Exception:
                failed=True
            if failed != (index==0):raise RuntimeError(f'Plugin installation fixture mismatch: {index}')
            passed.append(index)
        (root/'installation-verification.json').write_text(json.dumps({'order':passed,'lockReleased':not manager._pm_lock.locked()}))

    @filter.on_llm_request(priority=0)
    async def inject(self,event,req):
        req.system_prompt+='\nXIAOYU_HOOK_SENTINEL'

    @filter.on_decorating_result()
    async def decorate(self,event):
        from astrbot.api.message_components import Plain
        result=event.get_result()
        if result and result.chain:result.chain.append(Plain('[后处理已生效]'))
