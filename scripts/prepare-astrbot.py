"""Prepare this project's separate, pinned AstrBot instance; never edit global config."""
import json
import os
import pathlib
import sys
import argparse

project = pathlib.Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser()
parser.add_argument("--data-dir", default=str(project / "data"))
parser.add_argument("--index", choices=["official", "aliyun"], default="official")
parser.add_argument("--dashboard-port", type=int, default=6185)
parser.add_argument("--gateway-port", type=int, default=6199)
args = parser.parse_args()
base = pathlib.Path(args.data_dir).resolve()
root = base / "astrbot"
root.mkdir(parents=True, exist_ok=True)
(root / ".astrbot").touch()
for folder in ["config", "plugins", "temp"]:
    (root / "data" / folder).mkdir(parents=True, exist_ok=True)
os.environ["ASTRBOT_ROOT"] = str(root)
os.chdir(root)
file = root / "data" / "cmd_config.json"
if file.exists():
    raise SystemExit("Existing AstrBot configuration preserved; use its management panel.")
from astrbot.core.config.astrbot_config import AstrBotConfig
token = sys.stdin.readline().strip()
if len(token) < 24:
    raise SystemExit("Missing private gateway token")
config = AstrBotConfig(config_path=str(file))
config["dashboard"]["host"] = "127.0.0.1"
config["dashboard"]["port"] = args.dashboard_port
config["pypi_index_url"] = "https://pypi.org/simple" if args.index == "official" else "https://mirrors.aliyun.com/pypi/simple/"
config["pip_install_arg"] = "--timeout 15 --retries 1 --disable-pip-version-check"
config["provider_settings"]["enable"] = False
config["provider"] = []
config["admins_id"] = []
config["platform"] = [{"id": "xiaoyu_plugins", "type": "aiocqhttp", "enable": True,
    "ws_reverse_host": "127.0.0.1", "ws_reverse_port": args.gateway_port, "ws_reverse_token": token}]
config.save_config()
initial = getattr(config, "_generated_dashboard_password", None)
if initial:
    credentials = base / "astrbot-initial-login.txt"
    with credentials.open("x", encoding="utf-8") as output:
        output.write("AstrBot首次登录账号: astrbot\n初始密码: " + initial + "\n请在官方页面完成首次密码修改。本文件不会随修改更新，之后可自行移除。\n")
    credentials.chmod(0o600)
print("Prepared private local AstrBot instance; no model provider configured.")
