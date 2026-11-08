"""Exact-build accessibility experiment. Default operation is read-only.

--temporary-test requires separate user authorization. It changes one data byte,
never code, and restores the original value on command, EOF or a 30-second limit.
No registry, client files, permissions or persistent account settings are changed.
"""
import argparse
import ctypes
from ctypes import wintypes as w
import hashlib
import json
import ntpath
from pathlib import Path
import queue
import sys
import threading


def emit(row):
    print(json.dumps(row), flush=True)


class Client:
    def __init__(self, request, profile, writable=False):
        self.profile = profile
        self.kernel = k = ctypes.WinDLL('kernel32', use_last_error=True)
        self.modules = m = ctypes.WinDLL('psapi', use_last_error=True)
        k.OpenProcess.argtypes = [w.DWORD, w.BOOL, w.DWORD]
        k.OpenProcess.restype = w.HANDLE
        k.CloseHandle.argtypes = [w.HANDLE]
        k.QueryFullProcessImageNameW.argtypes = [w.HANDLE, w.DWORD, w.LPWSTR, ctypes.POINTER(w.DWORD)]
        k.QueryFullProcessImageNameW.restype = w.BOOL
        k.ReadProcessMemory.argtypes = [w.HANDLE, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_size_t, ctypes.POINTER(ctypes.c_size_t)]
        k.ReadProcessMemory.restype = w.BOOL
        k.WriteProcessMemory.argtypes = [w.HANDLE, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_size_t, ctypes.POINTER(ctypes.c_size_t)]
        k.WriteProcessMemory.restype = w.BOOL
        k.GetExitCodeProcess.argtypes = [w.HANDLE, ctypes.POINTER(w.DWORD)]
        k.GetExitCodeProcess.restype = w.BOOL
        m.EnumProcessModulesEx.argtypes = [w.HANDLE, ctypes.c_void_p, w.DWORD, ctypes.POINTER(w.DWORD), w.DWORD]
        m.EnumProcessModulesEx.restype = w.BOOL
        m.GetModuleFileNameExW.argtypes = [w.HANDLE, w.HMODULE, w.LPWSTR, w.DWORD]
        m.GetModuleFileNameExW.restype = w.DWORD
        self.handle = k.OpenProcess(0x1410 | (0x28 if writable else 0), False, request['pid'])
        if not self.handle:
            raise OSError('CLIENT_ACCESS_DENIED')
        try:
            image = ctypes.create_unicode_buffer(32768)
            length = w.DWORD(len(image))
            if not k.QueryFullProcessImageNameW(self.handle, 0, image, ctypes.byref(length)) or not same(image.value, request['executable']):
                raise OSError('CLIENT_IDENTITY_MISMATCH')
            if hashlib.sha256(Path(request['corePath']).read_bytes()).hexdigest() != profile['coreSha256']:
                raise OSError('CORE_FINGERPRINT_MISMATCH')
            modules = (w.HMODULE * 1024)()
            needed = w.DWORD()
            if not m.EnumProcessModulesEx(self.handle, modules, ctypes.sizeof(modules), ctypes.byref(needed), 3) or needed.value > ctypes.sizeof(modules):
                raise OSError('CORE_MODULE_UNAVAILABLE')
            bases = []
            for module in modules[:needed.value // ctypes.sizeof(w.HMODULE)]:
                name = ctypes.create_unicode_buffer(32768)
                if m.GetModuleFileNameExW(self.handle, module, name, len(name)) and same(name.value, request['corePath']):
                    bases.append(module)
            if len(bases) != 1:
                raise OSError('CORE_MODULE_AMBIGUOUS')
            self.base = bases[0]
            self.gate = self.base + int(profile['gateRva'], 0)
            self.check_code()
            if self.read(self.gate, 1)[0] not in (0, 1):
                raise OSError('GATE_VALUE_UNEXPECTED')
        except BaseException:
            self.close()
            raise

    def read(self, address, size):
        data = ctypes.create_string_buffer(size)
        got = ctypes.c_size_t()
        if not self.kernel.ReadProcessMemory(self.handle, address, data, size, ctypes.byref(got)) or got.value != size:
            raise OSError('CLIENT_READ_FAILED')
        return data.raw

    def check_code(self):
        if self.read(self.base, 2) != b'MZ':
            raise OSError('CORE_HEADER_MISMATCH')
        pe = self.base + int.from_bytes(self.read(self.base + 60, 4), 'little')
        if self.read(pe, 4) != b'PE\0\0' or int.from_bytes(self.read(pe + 4, 2), 'little') != int(self.profile['machine'], 16):
            raise OSError('CORE_ARCH_MISMATCH')
        if int.from_bytes(self.read(pe + 80, 4), 'little') != self.profile['imageSize']:
            raise OSError('CORE_SIZE_MISMATCH')
        if not 0 < int(self.profile['gateRva'], 0) < self.profile['imageSize']:
            raise OSError('GATE_OUT_OF_MODULE')
        for check in self.profile['codeChecks']:
            expected = bytes.fromhex(check['bytes'])
            if self.read(self.base + int(check['rva'], 0), len(expected)) != expected:
                raise OSError('CORE_CODE_MISMATCH')

    def write_gate(self, value):
        data = ctypes.c_ubyte(value)
        written = ctypes.c_size_t()
        if not self.kernel.WriteProcessMemory(self.handle, self.gate, ctypes.byref(data), 1, ctypes.byref(written)) or written.value != 1:
            raise OSError('GATE_WRITE_FAILED')
        if self.read(self.gate, 1)[0] != value:
            raise OSError('GATE_WRITE_UNCONFIRMED')

    def exited(self):
        code = w.DWORD()
        return self.kernel.GetExitCodeProcess(self.handle, ctypes.byref(code)) and code.value != 259

    def close(self):
        if self.handle:
            self.kernel.CloseHandle(self.handle)
            self.handle = None


def same(a, b):
    return ntpath.normcase(ntpath.normpath(a)) == ntpath.normcase(ntpath.normpath(b))


def restore_gate(client, original):
    if client.exited():
        return {'type':'restoration','restored':True,'reason':'client-exited-no-live-state'}
    try:
        client.check_code()
        current = client.read(client.gate, 1)[0]
        if current == 1:
            client.write_gate(original)
        elif current != original:
            raise OSError('GATE_CHANGED_EXTERNALLY')
        return {'type':'restoration','restored':True,'value':original,'observedBeforeRestore':current}
    except OSError as error:
        return {'type':'restoration','restored':False,'code':str(error)}


def temporary_gate(client, original, seconds, wait, report=emit):
    try:
        client.write_gate(1)
        report({'type':'phase','phase':'temporarily-enabled','seconds':seconds})
        wait(seconds)
    finally:
        report(restore_gate(client, original))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--temporary-test', action='store_true')
    args = parser.parse_args()
    profile = json.loads((Path(__file__).resolve().parent.parent / 'integrations/wechat/profiles/4.2.0.13-accessibility.json').read_text())
    request = json.loads(sys.stdin.readline())
    client = Client(request, profile, writable=args.temporary_test)
    try:
        original = client.read(client.gate, 1)[0]
        emit({'type':'inspection','version':profile['version'],'gate':original,'fingerprintMatched':True,'readOnly':not args.temporary_test})
        if not args.temporary_test or original == 1:
            return
        commands = queue.Queue()
        def receive():
            commands.put(sys.stdin.readline())
        threading.Thread(target=receive, daemon=True).start()
        def wait(seconds):
            try:
                commands.get(timeout=seconds)
            except queue.Empty:
                pass
        temporary_gate(client, original, min(30, profile['maxTestSeconds']), wait)
    finally:
        client.close()


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, KeyError) as error:
        emit({'type':'error','code':str(error)})
        sys.exit(1)
