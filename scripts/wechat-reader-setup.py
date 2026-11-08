"""Use the reference reader, with independently verified process discovery.

Toolhelp snapshots may omit a running client even when its PID can be queried.
The fallback uses CIM for discovery and rechecks each PID with QueryFullProcessImageName.
No permission elevation, process memory writes, or injection is performed by discovery.
"""
import ctypes
from ctypes import wintypes
import importlib.util
import io
import json
import ntpath
import os
from pathlib import Path
import subprocess
import sys


def integrity_level():
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    security = ctypes.WinDLL('advapi32', use_last_error=True)
    kernel.GetCurrentProcess.restype = wintypes.HANDLE
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    security.OpenProcessToken.argtypes = [wintypes.HANDLE, wintypes.DWORD, ctypes.POINTER(wintypes.HANDLE)]
    security.OpenProcessToken.restype = wintypes.BOOL
    security.GetTokenInformation.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(wintypes.DWORD)]
    security.GetTokenInformation.restype = wintypes.BOOL
    security.GetSidSubAuthorityCount.argtypes = [ctypes.c_void_p]
    security.GetSidSubAuthorityCount.restype = ctypes.POINTER(ctypes.c_ubyte)
    security.GetSidSubAuthority.argtypes = [ctypes.c_void_p, wintypes.DWORD]
    security.GetSidSubAuthority.restype = ctypes.POINTER(wintypes.DWORD)
    token = wintypes.HANDLE()
    if not security.OpenProcessToken(kernel.GetCurrentProcess(), 8, ctypes.byref(token)):
        raise OSError('PROCESS_TOKEN_UNAVAILABLE')
    try:
        size = wintypes.DWORD()
        security.GetTokenInformation(token, 25, None, 0, ctypes.byref(size))
        if not size.value or size.value > 65536:
            raise OSError('PROCESS_TOKEN_UNAVAILABLE')
        buffer = ctypes.create_string_buffer(size.value)
        if not security.GetTokenInformation(token, 25, buffer, size, ctypes.byref(size)):
            raise OSError('PROCESS_TOKEN_UNAVAILABLE')
        sid = ctypes.cast(buffer, ctypes.POINTER(ctypes.c_void_p))[0]
        count = security.GetSidSubAuthorityCount(sid)[0]
        return security.GetSidSubAuthority(sid, count - 1)[0]
    finally:
        kernel.CloseHandle(token)


def matching_roots(rows, executable):
    expected = ntpath.normcase(ntpath.normpath(executable))
    matched = {int(r['ProcessId']): int(r['ParentProcessId']) for r in rows
               if isinstance(r.get('ExecutablePath'), str)
               and ntpath.normcase(ntpath.normpath(r['ExecutablePath'])) == expected}
    roots = []
    for pid, parent in matched.items():
        if pid <= 0 or parent == pid:
            raise ValueError('WECHAT_PROCESS_IDENTITY_UNCLEAR')
        seen = {pid}
        ancestor = parent
        while ancestor in matched:
            if ancestor in seen:
                raise ValueError('WECHAT_PROCESS_IDENTITY_UNCLEAR')
            seen.add(ancestor)
            ancestor = matched[ancestor]
        if parent not in matched:
            roots.append(pid)
    if matched and not roots:
        raise ValueError('WECHAT_PROCESS_IDENTITY_UNCLEAR')
    return roots


def verified_path(pid, executable):
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    kernel.OpenProcess.restype = wintypes.HANDLE
    kernel.QueryFullProcessImageNameW.argtypes = [wintypes.HANDLE, wintypes.DWORD,
                                                 wintypes.LPWSTR, ctypes.POINTER(wintypes.DWORD)]
    kernel.QueryFullProcessImageNameW.restype = wintypes.BOOL
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    process = kernel.OpenProcess(0x1000, False, pid)
    if not process:
        return False
    try:
        length = wintypes.DWORD(32768)
        buffer = ctypes.create_unicode_buffer(length.value)
        if not kernel.QueryFullProcessImageNameW(process, 0, buffer, ctypes.byref(length)):
            return False
        return ntpath.normcase(ntpath.normpath(buffer.value)) == ntpath.normcase(ntpath.normpath(executable))
    finally:
        kernel.CloseHandle(process)


def select_live_identity(results):
    # A second launcher can remain alive without opening an account database.
    # Probe every candidate; never guess by title/PID or ignore a failed probe.
    if not results or any(not isinstance(r, dict) or not isinstance(r.get('accountDirectories'), list) for r in results):
        raise ValueError('WECHAT_PROCESS_IDENTITY_UNCLEAR')
    active = [r for r in results if r['accountDirectories']]
    if len(active) != 1 or len(active[0]['accountDirectories']) != 1 or not active[0].get('databaseHandleCount', 0):
        raise ValueError('WECHAT_PROCESS_IDENTITY_UNCLEAR')
    return active[0]


def resolver(reference):
    cached = []

    def pids(executable):
        nonlocal cached
        if cached and all(verified_path(pid, executable) for pid in cached):
            return cached
        cached = reference.wechat_pids(executable)
        if cached:
            return cached
        powershell = Path(os.environ.get('SystemRoot', r'C:\Windows')) / 'System32/WindowsPowerShell/v1.0/powershell.exe'
        code = "@((Get-CimInstance Win32_Process -Filter \"Name='Weixin.exe' OR Name='WeChat.exe'\") | Select-Object ProcessId,ParentProcessId,ExecutablePath) | ConvertTo-Json -Compress"
        env = dict(os.environ)
        for key in list(env):
            if key.casefold() == 'psmodulepath':
                del env[key]
        env['PSModulePath'] = str(powershell.parent / 'Modules')
        try:
            result = subprocess.run([str(powershell), '-NoProfile', '-NonInteractive', '-Command', code],
                                    capture_output=True, timeout=8, env=env, creationflags=0x08000000)
            if result.returncode:
                raise ValueError('CIM failed')
            rows = json.loads(result.stdout.decode('utf-8-sig') or '[]') or []
            rows = rows if isinstance(rows, list) else [rows]
            discovered = matching_roots(rows, executable)
            if not all(verified_path(pid, executable) for pid in discovered):
                raise ValueError('PID identity changed or unavailable')
            cached = discovered
            if cached:
                reference.progress('系统进程检测已核验当前微信，正在进行本次读取组件试接。')
            return cached
        except (OSError, ValueError, KeyError, subprocess.TimeoutExpired):
            raise reference.SetupError('WECHAT_PROCESS_IDENTITY_UNCLEAR') from None

    return pids


def main():
    request = {'operation':'environment'} if len(sys.argv)>2 and sys.argv[2]=='--environment' else json.loads(sys.stdin.read(128001))
    if request.get('operation') == 'environment':
        try:
            level = integrity_level()
            print(json.dumps({'type':'result','ok':True,'integrityLevel':level,'captureAllowed':level>=8192}))
        except OSError:
            print(json.dumps({'type':'result','ok':False,'code':'READER_HELPER_ENVIRONMENT_UNKNOWN'}))
        return
    root = Path(sys.argv[1]).resolve()
    sys.path.insert(0, str(root / 'scripts'))
    spec = importlib.util.spec_from_file_location('xiaoyu_reference_reader', root / 'scripts/reader_setup.py')
    reference = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(reference)
    if request.get('operation') == 'live-identity':
        try:
            if integrity_level() < 8192:
                raise reference.SetupError('READER_HELPER_LOW_INTEGRITY')
            pids = resolver(reference)(request['wechatExecutable'])
            probe_spec = importlib.util.spec_from_file_location('xiaoyu_account_probe', Path(__file__).with_name('wechat-live-account.py'))
            probe = importlib.util.module_from_spec(probe_spec)
            probe_spec.loader.exec_module(probe)
            result = select_live_identity([probe.account_handles(pid, request['wechatExecutable']) for pid in pids])
            reference.emit({'type':'result','ok':True,**result})
        except (OSError, reference.SetupError, ValueError, KeyError):
            reference.emit({'type':'result','ok':False,'code':'WECHAT_LIVE_IDENTITY_UNAVAILABLE'})
        return
    original_capture = reference.capture_key
    process_pids = resolver(reference)

    def capture(executable, account, timeout=180):
        try:
            level = integrity_level()
        except OSError:
            raise reference.SetupError('READER_HELPER_ENVIRONMENT_UNKNOWN') from None
        if level < 8192:
            raise reference.SetupError('READER_HELPER_LOW_INTEGRITY')
        return original_capture(executable, account, timeout=timeout, pids=process_pids)

    reference.capture_key = capture
    sys.stdin = io.StringIO(json.dumps(request))
    reference.main()


if __name__ == '__main__':
    main()
