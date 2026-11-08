"""Read-only account evidence from a verified client's open database handles.

Only duplicate handles into this helper; never close or change a client handle.
No process-memory reads, injection, process termination or file writes.
"""
import ctypes
from ctypes import wintypes as w
import ntpath


def account_from_path(value):
    value = value.removeprefix('\\\\?\\').replace('/', '\\')
    parts = value.split('\\')
    lowered = [part.casefold() for part in parts]
    for i, part in enumerate(lowered):
        if part == 'xwechat_files' and i + 3 < len(parts) and lowered[i + 2] == 'db_storage':
            if value.casefold().endswith(('.db', '.db-wal', '.db-shm')):
                return parts[i + 1]
    return None


def account_handles(pid, executable):
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    native = ctypes.WinDLL('ntdll')
    kernel.OpenProcess.argtypes = [w.DWORD, w.BOOL, w.DWORD]
    kernel.OpenProcess.restype = w.HANDLE
    kernel.CloseHandle.argtypes = [w.HANDLE]
    kernel.GetCurrentProcess.restype = w.HANDLE
    kernel.QueryFullProcessImageNameW.argtypes = [w.HANDLE, w.DWORD, w.LPWSTR, ctypes.POINTER(w.DWORD)]
    kernel.QueryFullProcessImageNameW.restype = w.BOOL
    kernel.DuplicateHandle.argtypes = [w.HANDLE, w.HANDLE, w.HANDLE, ctypes.POINTER(w.HANDLE), w.DWORD, w.BOOL, w.DWORD]
    kernel.DuplicateHandle.restype = w.BOOL
    kernel.GetFileType.argtypes = [w.HANDLE]
    kernel.GetFileType.restype = w.DWORD
    kernel.GetFinalPathNameByHandleW.argtypes = [w.HANDLE, w.LPWSTR, w.DWORD, w.DWORD]
    kernel.GetFinalPathNameByHandleW.restype = w.DWORD
    native.NtQuerySystemInformation.argtypes = [w.ULONG, ctypes.c_void_p, w.ULONG, ctypes.POINTER(w.ULONG)]
    native.NtQuerySystemInformation.restype = ctypes.c_long

    class Entry(ctypes.Structure):
        _fields_ = [('object', ctypes.c_void_p), ('pid', ctypes.c_size_t), ('handle', ctypes.c_size_t),
                    ('access', w.ULONG), ('trace', w.USHORT), ('kind', w.USHORT),
                    ('attributes', w.ULONG), ('reserved', w.ULONG)]

    process = kernel.OpenProcess(0x1040, False, pid)
    if not process:
        raise OSError('WECHAT_HANDLE_QUERY_DENIED')
    try:
        length = w.DWORD(32768)
        image = ctypes.create_unicode_buffer(length.value)
        if not kernel.QueryFullProcessImageNameW(process, 0, image, ctypes.byref(length)):
            raise OSError('WECHAT_PROCESS_IDENTITY_UNCLEAR')
        if ntpath.normcase(ntpath.normpath(image.value)) != ntpath.normcase(ntpath.normpath(executable)):
            raise OSError('WECHAT_PROCESS_IDENTITY_UNCLEAR')
        size = 1024 * 1024
        while size <= 64 * 1024 * 1024:
            data = ctypes.create_string_buffer(size)
            needed = w.ULONG()
            status = native.NtQuerySystemInformation(64, data, size, ctypes.byref(needed))
            if status == 0:
                break
            if status & 0xffffffff != 0xc0000004:
                raise OSError('WECHAT_HANDLE_QUERY_FAILED')
            size = max(size * 2, needed.value + 65536)
        else:
            raise OSError('WECHAT_HANDLE_QUERY_LIMIT')
        count = ctypes.c_size_t.from_buffer(data).value
        start = ctypes.sizeof(ctypes.c_size_t) * 2
        if count > (size - start) // ctypes.sizeof(Entry):
            raise OSError('WECHAT_HANDLE_QUERY_INVALID')
        accounts = set()
        matched = 0
        current = kernel.GetCurrentProcess()
        for i in range(count):
            entry = Entry.from_buffer(data, start + i * ctypes.sizeof(Entry))
            if entry.pid != pid:
                continue
            duplicate = w.HANDLE()
            if not kernel.DuplicateHandle(process, entry.handle, current, ctypes.byref(duplicate), 0, False, 2):
                continue
            try:
                if kernel.GetFileType(duplicate) != 1:
                    continue
                buffer = ctypes.create_unicode_buffer(32768)
                length = kernel.GetFinalPathNameByHandleW(duplicate, buffer, len(buffer), 0)
                if not length or length >= len(buffer):
                    continue
                account = account_from_path(buffer.value)
                if account:
                    accounts.add(account)
                    matched += 1
            finally:
                kernel.CloseHandle(duplicate)
        return {'clientPid': pid, 'accountDirectories': sorted(accounts), 'databaseHandleCount': matched}
    finally:
        kernel.CloseHandle(process)
