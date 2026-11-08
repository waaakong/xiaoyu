"""Local Codex provider: requests must belong to a live Xiaoyu event lease."""
import os
import re
import asyncio
import logging
from contextvars import ContextVar

import aiohttp
from astrbot.core.platform.astr_message_event import current_message_event
from astrbot.core.provider.provider import Provider
from astrbot.core.provider.register import register_provider_adapter
from astrbot.core.provider.entities import LLMResponse, TokenUsage

pipeline_owner = ContextVar("xiaoyu_pipeline_owner", default=None)
reply_owner = ContextVar("xiaoyu_reply_owner", default=None)


def fit_model_history(system, prompt, messages):
    """Bound transport before JSON serialization; preserve mandatory input verbatim."""
    units = lambda text: len(text.encode('utf-16-le')) // 2
    remaining = 32000 - units(system) - units(prompt)
    if remaining < 0:
        raise RuntimeError(f"插件必要输入超出32000字符预算（系统提示{units(system)}，当前问题{units(prompt)}）；请缩短插件提示词或当前输入")
    unique = []
    for message in messages:
        if not unique or unique[-1] != message:
            unique.append(message)
    kept = []
    for message in reversed(unique):
        if len(kept) >= 40 or remaining <= 0:
            break
        size = units(message['content'])
        if size <= remaining:
            kept.append(message)
            remaining -= size
        else:
            marker = '[较早内容已省略]\n'
            available = remaining - units(marker)
            if available > 0:
                tail = message['content'].encode('utf-16-le')[-available * 2:].decode('utf-16-le', errors='ignore')
                kept.append({**message, 'content': marker + tail})
            break
    kept.reverse()
    if kept != messages:
        logging.getLogger('xiaoyu.model_budget').info('插件历史整理：系统=%d 当前=%d 历史=%d→%d', units(system), units(prompt), len(messages), len(kept))
    return kept

MEMORY_PLUGINS = frozenset({
    "astrbot_plugin_angel_memory", "astrbot_plugin_livingmemory",
    "astrbot_plugin_self_learning",
})


def coordinate_memory_plugins(event, star_map):
    """Scope hook selection to this leased event; never disable global plugins."""
    raw=getattr(getattr(event,'message_obj',None),'raw_message',None)
    command_lease=raw.get('xiaoyu_lease_id') if hasattr(raw,'get') else None
    if not request_id(event) and not (isinstance(command_lease,str) and re.fullmatch(r'[a-f0-9-]{36}',command_lease)):
        return

    def excluded(module, plugin):
        return any(name in module.split(".") or name == getattr(plugin, "name", None)
                   for name in MEMORY_PLUGINS)

    blocked = {plugin.name for module, plugin in star_map.items()
               if excluded(module, plugin)}
    current = event.plugins_name
    if current is None or current == ["*"]:
        current = [plugin.name for plugin in star_map.values()
                   if getattr(plugin, "activated", False)]
    event.plugins_name = [name for name in current if name not in blocked]
    handlers = event.get_extra("activated_handlers") or []
    event.set_extra("activated_handlers", [h for h in handlers
                    if not excluded(h.handler_module_path, star_map.get(h.handler_module_path))])
    event.set_extra("xiaoyu_memory_owner", "xiaoyu")
    event.set_extra("xiaoyu_memory_excluded", sorted(blocked))


def request_id(event):
    raw = getattr(getattr(event, "message_obj", None), "raw_message", None)
    value = raw.get("xiaoyu_request_id") if hasattr(raw, "get") else None
    return value if isinstance(value, str) and re.fullmatch(r"[a-f0-9-]{36}", value) else None


async def bridge_request(route, payload):
    url = os.environ.get("XIAOYU_MODEL_URL", "")
    token = os.environ.get("XIAOYU_MODEL_TOKEN", "")
    if not re.fullmatch(r"http://127\.0\.0\.1:\d+", url) or len(token) < 24:
        raise RuntimeError("小鱼本机模型桥接未启动")
    timeout = aiohttp.ClientTimeout(total=180, connect=5)
    async with aiohttp.ClientSession(timeout=timeout, trust_env=False) as session:
        async with session.post(url + route, json=payload, headers={"x-xiaoyu-token": token}, allow_redirects=False) as response:
            result = await response.json()
            if response.status != 200:
                raise RuntimeError(result.get("error", "本机模型请求失败"))
            return result


@register_provider_adapter("xiaoyu_local_codex", "小鱼本机Codex：仅处理已授权增强聊天", provider_display_name="小鱼 · 本机 Codex")
class XiaoyuCodexProvider(Provider):
    def __init__(self, provider_config, provider_settings):
        super().__init__(provider_config, provider_settings)
        self.model_name = "local-codex"

    def get_current_key(self):
        return ""

    def set_key(self, key):
        if key:
            raise ValueError("本机Codex不配置第三方API Key")

    async def get_models(self):
        return ["local-codex"]

    async def test(self, timeout=45):
        # A provider test cannot manufacture a QQ lease or consume model tokens.
        return None

    async def text_chat(self, prompt=None, session_id=None, image_urls=None, audio_urls=None, func_tool=None, contexts=None, system_prompt=None, tool_calls_result=None, model=None, extra_user_content_parts=None, tool_choice="auto", **kwargs):
        event = current_message_event.get()
        trace = request_id(event)
        if not trace:
            raise RuntimeError("仅已授权的小鱼增强事件可调用本机Codex；后台主动调用未开放")
        is_reply = reply_owner.get() is asyncio.current_task()
        if not is_reply and pipeline_owner.get() is not asyncio.current_task():
            raise RuntimeError("后台派生任务不能继承本轮聊天的模型调用权限；请使用当前事件内同步等待的增强钩子")
        if audio_urls or tool_calls_result or tool_choice == "required":
            raise RuntimeError("当前适配器不支持AstrBot音频识别或第三方函数调用协议")
        messages = []
        for item in self._ensure_message_to_dicts(contexts):
            role, content = item.get("role"), item.get("content", "")
            if role not in {"user", "assistant", "system"}:
                continue
            if isinstance(content, list):
                content = "\n".join(str(part.get("text", "")) for part in content if isinstance(part, dict) and part.get("type") == "text")
            if not isinstance(content, str):
                raise ValueError("仅支持纯文本上下文")
            messages.append({"role": role, "content": content})
        additions = []
        for part in extra_user_content_parts or []:
            if hasattr(part, "model_dump"):
                part = part.model_dump()
            if isinstance(part, dict) and part.get("type") == "text":
                additions.append(str(part.get("text", "")))
        final_prompt = (prompt or "") + ("\n" + "\n".join(additions) if additions else "")
        system = system_prompt or ""
        messages = fit_model_history(system, final_prompt, messages)
        result = await bridge_request("/model", {
            "trace": trace,
            "purpose": "reply" if is_reply else "aux",
            "prompt": final_prompt,
            "system": system,
            "contexts": messages,
        })
        usage = result.get("usage") or {}
        return LLMResponse(role="assistant", completion_text=result["reply"], usage=TokenUsage(input_other=usage.get("inputTokens", 0), output=usage.get("outputTokens", 0)))

    async def text_chat_stream(self, **kwargs):
        yield await self.text_chat(**kwargs)


def install_pipeline_completion():
    """AstrBot event_context supplies task-local identity; no last-chat globals."""
    from astrbot.core.pipeline.scheduler import PipelineScheduler
    original = PipelineScheduler.execute
    if getattr(original, "_xiaoyu_wrapped", False):
        return

    from astrbot.core.pipeline.waking_check.stage import WakingCheckStage
    from astrbot.core.star.star import star_map
    waking = WakingCheckStage.process

    async def scoped_waking(self, event):
        result = await waking(self, event)
        coordinate_memory_plugins(event, star_map)
        return result

    WakingCheckStage.process = scoped_waking

    # AstrBot's stop-aware runner creates an awaited operation task for the
    # actual model call. Bind that exact task; arbitrary plugin child tasks do
    # not inherit permission merely by copying its ContextVars.
    from astrbot.core.agent.runners.tool_loop_agent_runner import ToolLoopAgentRunner
    await_operation = ToolLoopAgentRunner._await_or_stop

    async def await_or_stop(self, awaitable):
        async def foreground():
            token = reply_owner.set(asyncio.current_task())
            try:
                return await awaitable
            finally:
                reply_owner.reset(token)
        return await await_operation(self, foreground())

    ToolLoopAgentRunner._await_or_stop = await_or_stop

    async def execute(self, event):
        trace = request_id(event)
        owner_token = pipeline_owner.set(asyncio.current_task())
        failed = False
        try:
            return await original(self, event)
        except BaseException:
            failed = True
            raise
        finally:
            pipeline_owner.reset(owner_token)
            if trace:
                try:
                    await bridge_request("/complete", {"trace": trace, "error": failed})
                except Exception:
                    from astrbot.core import logger
                    logger.warning("小鱼增强流程完成回执未确认，请检查请求诊断；不重发回复。")

    execute._xiaoyu_wrapped = True
    PipelineScheduler.execute = execute
