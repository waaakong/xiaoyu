"""Pinned AstrBot installer adapter: pip never runs inside the chat process."""
import asyncio
import collections
import json
import os
import pathlib
import re
import subprocess
import sys
import time

_pip_lock = asyncio.Lock()


class PluginOperationLock(asyncio.Lock):
    async def acquire(self):
        try:
            return await asyncio.wait_for(super().acquire(), 30)
        except TimeoutError as exc:
            raise RuntimeError("另一个插件操作仍在进行，请查看依赖安装状态后重试，不需要重复点击安装") from exc


def _status(state, **fields):
    root = os.environ.get("ASTRBOT_ROOT")
    if not root:
        return
    try:
        file = pathlib.Path(root) / "data" / "xiaoyu-installer-status.json"
        temp = file.with_suffix(".tmp")
        temp.write_text(json.dumps({"state": state, "time": time.time(), **fields}), encoding="utf-8")
        temp.replace(file)
    except OSError:
        pass


async def _terminate(child):
    if child.returncode is not None:
        return
    if sys.platform == "win32":
        killer = await asyncio.create_subprocess_exec(
            "taskkill.exe", "/PID", str(child.pid), "/T", "/F",
            stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL,
            creationflags=subprocess.CREATE_NO_WINDOW,
        )
        await killer.wait()
    elif child.returncode is None:
        child.kill()
    await child.wait()


async def run_child(argv, *, timeout=240, env=None, log=None):
    """Bound the process lifetime and output, including cancellation cleanup."""
    flags = {"creationflags": subprocess.CREATE_NO_WINDOW} if sys.platform == "win32" else {}
    child = await asyncio.create_subprocess_exec(
        *argv, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT,
        env=env, **flags,
    )
    lines = collections.deque(maxlen=80)

    async def consume():
        pending = ""
        while chunk := await child.stdout.read(4096):
            pending += chunk.decode("utf-8", errors="replace")
            while "\n" in pending or len(pending) > 4096:
                if "\n" in pending:
                    line, pending = pending.split("\n", 1)
                else:
                    line, pending = pending[:4096], pending[4096:]
                # Do not persist authenticated index URL credentials.
                line = re.sub(r"(https?://)[^/\s@]+@", r"\1[hidden]@", line.rstrip())
                lines.append(line)
                if log:
                    log(line)
        if pending:
            lines.append(pending[:4096])
        return await child.wait(), list(lines)

    try:
        return await asyncio.wait_for(consume(), timeout)
    except BaseException:
        await _terminate(child)
        raise


def install_installer_adapter():
    from astrbot.core import logger
    from astrbot.core.utils import pip_installer as pip
    if getattr(pip.PipInstaller._run_pip_in_process, "_xiaoyu_wrapped", False):
        return

    async def run_pip(self, args):
        try:
            await asyncio.wait_for(_pip_lock.acquire(), 30)
        except TimeoutError as exc:
            raise pip.PipInstallError("另一个依赖安装仍在进行，请稍后重试", code=75) from exc
        started = time.time()
        _status("installing", started=started, timeoutSeconds=240)
        try:
            env = dict(os.environ)
            env.update(pip._build_packaged_windows_runtime_build_env(base_env=env))
            env["PYTHONUTF8"] = "1"
            env["PIP_NO_INPUT"] = "1"
            code, lines = await run_child([sys.executable, "-u", "-m", "pip", *args], env=env, log=logger.info)
            _status("succeeded" if code == 0 else "failed", elapsedSeconds=round(time.time()-started, 1))
            if code != 0:
                conflict = pip._classify_pip_failure(lines)
                if conflict:
                    raise conflict
            return code
        except TimeoutError as exc:
            _status("timed-out", elapsedSeconds=round(time.time()-started, 1))
            raise pip.PipInstallError("依赖安装超过240秒，子进程已终止，可重试或检查网络/依赖冲突", code=124) from exc
        except BaseException:
            _status("failed", elapsedSeconds=round(time.time()-started, 1))
            raise
        finally:
            _pip_lock.release()

    run_pip._xiaoyu_wrapped = True
    pip.PipInstaller._run_pip_in_process = run_pip
    from astrbot.core.star.star_manager import PluginManager
    from astrbot.core.star.updater import _PluginUpdater
    original_init = PluginManager.__init__

    def initialize(self, *args, **kwargs):
        original_init(self, *args, **kwargs)
        self._pm_lock = PluginOperationLock()

    PluginManager.__init__ = initialize
    download = _PluginUpdater._download_file

    async def bounded_download(self, *args, **kwargs):
        started = time.time()
        _status("downloading", started=started, timeoutSeconds=180)
        try:
            result = await asyncio.wait_for(download(self, *args, **kwargs), 180)
            _status("downloaded", elapsedSeconds=round(time.time()-started, 1))
            return result
        except TimeoutError as exc:
            _status("timed-out", elapsedSeconds=round(time.time()-started, 1))
            raise RuntimeError("插件下载超过180秒，请检查仓库网络后重试") from exc
        except BaseException:
            _status("failed", elapsedSeconds=round(time.time()-started, 1))
            raise

    _PluginUpdater._download_file = bounded_download
    logger.info("小鱼依赖安装保护已启用：独立pip进程、240秒超时，保留核心依赖约束。")
