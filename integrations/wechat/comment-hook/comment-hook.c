// Read-only capture of WeChat SnsComment request. No modification of request data.
#include <windows.h>
#include <stdint.h>
#include <string.h>

#define TARGET_RVA 0x57ad680ULL
#define WRAPPER_VT_RVA 0x96ff8d8ULL
#define CAPTURE_PATH L"C:\\Users\\WaaaKong\\Desktop\\file\\DPF\\tmp\\comment-capture.bin"
#define LOG_PATH L"C:\\Users\\WaaaKong\\Desktop\\file\\DPF\\tmp\\comment-hook.log"

static HMODULE g_weixin;
static uint8_t* g_target;
static uint8_t* g_tramp;
static volatile LONG g_busy;
static volatile LONG g_hits;
static uint8_t g_orig[6];

static void logmsg(const char* s) {
  HANDLE h = CreateFileW(LOG_PATH, FILE_APPEND_DATA, FILE_SHARE_READ | FILE_SHARE_WRITE, NULL, OPEN_ALWAYS, FILE_ATTRIBUTE_NORMAL, NULL);
  if (h == INVALID_HANDLE_VALUE) return;
  DWORD wrote = 0;
  WriteFile(h, s, (DWORD)lstrlenA(s), &wrote, NULL);
  CloseHandle(h);
}

typedef void (*orig_fn)(void*, void*);

static int readable(const void* p, size_t n) {
  uintptr_t a = (uintptr_t)p, end = a + n;
  MEMORY_BASIC_INFORMATION m;
  if (n == 0) return 0;
  while (a < end) {
    if (!VirtualQuery((LPCVOID)a, &m, sizeof(m))) return 0;
    if (m.State != MEM_COMMIT) return 0;
    if (m.Protect & (PAGE_NOACCESS | PAGE_GUARD)) return 0;
    a = (uintptr_t)m.BaseAddress + m.RegionSize;
  }
  return 1;
}

static void write_block(HANDLE h, const void* p, uint32_t n) {
  DWORD wrote = 0;
  if (n && readable(p, n)) WriteFile(h, p, n, &wrote, NULL);
}

static void dump_request(void* req, void* wrap) {
  uintptr_t inner = 0;
  if (readable((char*)wrap + 0x18, sizeof(uintptr_t))) inner = *(uintptr_t*)((char*)wrap + 0x18);

  HANDLE h = CreateFileW(CAPTURE_PATH, GENERIC_WRITE, FILE_SHARE_READ, NULL, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, NULL);
  if (h == INVALID_HANDLE_VALUE) return;

  struct {
    char magic[8];
    uint32_t pid;
    uint32_t hits;
    uint64_t base;
    uint64_t req;
    uint64_t wrap;
    uint64_t inner;
    uint32_t reqLen;
    uint32_t wrapLen;
    uint32_t innerLen;
    uint32_t frameCount;
  } hdr;
  memcpy(hdr.magic, "XYCMT01", 8);
  hdr.pid = GetCurrentProcessId();
  hdr.hits = (uint32_t)g_hits;
  hdr.base = (uint64_t)g_weixin;
  hdr.req = (uint64_t)req;
  hdr.wrap = (uint64_t)wrap;
  hdr.inner = (uint64_t)inner;
  hdr.reqLen = 0x2b0;
  hdr.wrapLen = 0x40;
  hdr.innerLen = 0x200;
  void* frames[16] = {0};
  hdr.frameCount = (uint32_t)RtlCaptureStackBackTrace(0, 16, frames, NULL);

  DWORD wrote = 0;
  WriteFile(h, &hdr, sizeof(hdr), &wrote, NULL);
  write_block(h, req, hdr.reqLen);
  write_block(h, wrap, hdr.wrapLen);
  if (inner) write_block(h, (void*)inner, hdr.innerLen);
  WriteFile(h, frames, hdr.frameCount * sizeof(void*), &wrote, NULL);
  CloseHandle(h);
}

static void __fastcall detour(void* a, void* b) {
  logmsg("detour\r\n");
  if (InterlockedCompareExchange(&g_busy, 1, 0) == 0) {
    if (readable(b, sizeof(uintptr_t)) && *(uintptr_t*)b == (uintptr_t)g_weixin + WRAPPER_VT_RVA) {
      InterlockedIncrement(&g_hits);
      logmsg("hit\r\n");
      dump_request(a, b);
    }
    InterlockedExchange(&g_busy, 0);
  }
  ((orig_fn)g_tramp)(a, b);
}

static uint8_t* alloc_near(uint8_t* target) {
  SYSTEM_INFO si;
  GetSystemInfo(&si);
  uintptr_t gran = si.dwAllocationGranularity;
  uintptr_t base = (uintptr_t)target & ~(uintptr_t)(gran - 1);
  for (uintptr_t off = 0; off < 0x70000000ULL; off += gran) {
    uintptr_t addrs[2] = {base + off, base - off};
    for (int i = 0; i < 2; i++) {
      if (i == 1 && addrs[1] < gran) continue;
      void* p = VirtualAlloc((void*)addrs[i], 4096, MEM_RESERVE | MEM_COMMIT, PAGE_EXECUTE_READWRITE);
      if (p) return (uint8_t*)p;
    }
  }
  return NULL;
}

__declspec(dllexport) int XiaoyuCommentHookStart(void) {
  if (g_tramp) return 0;
  g_weixin = GetModuleHandleW(L"Weixin.dll");
  if (!g_weixin) return -1;
  g_target = (uint8_t*)g_weixin + TARGET_RVA;
  if (g_target[0] == 0xE9) {
    DWORD old0 = 0;
    if (VirtualProtect(g_target, 16, PAGE_EXECUTE_READWRITE, &old0)) {
      memcpy(g_target, "\x56\x57\x48\x83\xEC\x28", 6);
      FlushInstructionCache(GetCurrentProcess(), g_target, 16);
      VirtualProtect(g_target, 16, old0, &old0);
      logmsg("start restored-old\r\n");
    }
  }
  if (memcmp(g_target, "\x56\x57\x48\x83\xEC\x28", 6) != 0) return -2;
  memcpy(g_orig, g_target, 6);
  g_tramp = alloc_near(g_target);
  if (!g_tramp) return -3;

  memcpy(g_tramp, g_orig, 6);
  g_tramp[6] = 0xE9;
  *(int32_t*)(g_tramp + 7) = (int32_t)((g_target + 6) - (g_tramp + 11));

  DWORD old = 0;
  if (!VirtualProtect(g_target, 16, PAGE_EXECUTE_READWRITE, &old)) return -4;
  g_target[0] = 0xE9;
  *(int32_t*)(g_target + 1) = (int32_t)((uint8_t*)detour - (g_target + 5));
  g_target[5] = 0x90;
  FlushInstructionCache(GetCurrentProcess(), g_target, 16);
  VirtualProtect(g_target, 16, old, &old);
  return 0;
}

__declspec(dllexport) int XiaoyuCommentHookStop(void) {
  if (!g_target) return 0;
  DWORD old = 0;
  if (!VirtualProtect(g_target, 16, PAGE_EXECUTE_READWRITE, &old)) return -1;
  memcpy(g_target, g_orig, 6);
  FlushInstructionCache(GetCurrentProcess(), g_target, 16);
  VirtualProtect(g_target, 16, old, &old);
  g_target = NULL;
  return 0;
}

__declspec(dllexport) int XiaoyuCommentHookHits(void) { return (int)g_hits; }

static volatile LONG g_started;
__declspec(dllexport) LRESULT CALLBACK XiaoyuCommentHookProc(int code, WPARAM wParam, LPARAM lParam) {
  if (code >= 0 && InterlockedCompareExchange(&g_started, 1, 0) == 0) {
    logmsg("hookproc\r\n");
    int rc = XiaoyuCommentHookStart();
    if (rc == 0) logmsg("start ok\r\n");
    else if (rc == -1) logmsg("start no-weixin\r\n");
    else if (rc == -2) logmsg("start bad-prologue\r\n");
    else if (rc == -3) logmsg("start no-tramp\r\n");
    else if (rc == -4) logmsg("start prot-fail\r\n");
    else logmsg("start other\r\n");
  }
  return CallNextHookEx(NULL, code, wParam, lParam);
}

__declspec(dllexport) int XiaoyuCommentHookStart(void);

static DWORD WINAPI start_thread(LPVOID param) {
  (void)param;
  Sleep(500);
  for (int i = 0; i < 150; i++) {
    int rc = XiaoyuCommentHookStart();
    if (rc == 0) { logmsg("thread start ok\r\n"); return 0; }
    if (rc == -1) { Sleep(200); continue; }
    if (rc == -2) logmsg("thread bad-prologue\r\n");
    else if (rc == -3) logmsg("thread no-tramp\r\n");
    else if (rc == -4) logmsg("thread prot-fail\r\n");
    else logmsg("thread other\r\n");
    return 0;
  }
  logmsg("thread timeout\r\n");
  return 0;
}

BOOL WINAPI DllMain(HINSTANCE inst, DWORD reason, LPVOID reserved) {
  (void)inst; (void)reserved;
  if (reason == DLL_PROCESS_ATTACH) {
    DisableThreadLibraryCalls(inst);
    CreateThread(NULL, 0, start_thread, NULL, 0, NULL);
  }
  return TRUE;
}