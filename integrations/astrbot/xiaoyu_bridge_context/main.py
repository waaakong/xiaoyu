import sys
from astrbot.api.star import Star
from astrbot.api.event import filter


class XiaoyuBridgeContext(Star):
    @filter.on_llm_request(priority=-sys.maxsize)
    async def bind_request(self, event, req):
        from xiaoyu_provider import request_id
        if request_id(event):
            event.set_extra("xiaoyu_final_request", True)
            # Third-party function-call protocols are intentionally not exposed.
            req.func_tool = None
