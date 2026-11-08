"""Start the pinned AstrBot with the Xiaoyu local provider, without patching it."""
import pathlib
import sys

project = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(project / "integrations" / "astrbot"))
from xiaoyu_provider import install_pipeline_completion
from xiaoyu_installer import install_installer_adapter
import xiaoyu_wechat

install_installer_adapter()
install_pipeline_completion()
from astrbot.cli.__main__ import cli

cli(args=["run"])
