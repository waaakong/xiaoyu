"""Local interface fixture: no model requests, no external network."""
from pathlib import Path
from astrbot.api.event import filter, AstrMessageEvent
from astrbot.api.star import Star
from astrbot.api.message_components import Image

class ImageTest(Star):
    @filter.command("xyimage")
    async def image_test(self, event: AstrMessageEvent):
        png = Path(__file__).with_name("fixture.png").read_bytes()
        yield event.chain_result([Image.fromBytes(png)])
