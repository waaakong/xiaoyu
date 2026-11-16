#include <windows.h>
#include <stdio.h>
#include <stdlib.h>

static DWORD target_pid;
static HWND target_window;

static BOOL CALLBACK find_window(HWND hwnd, LPARAM lp) {
  DWORD pid = 0;
  GetWindowThreadProcessId(hwnd, &pid);
  if (pid != target_pid || !IsWindowVisible(hwnd) || GetWindow(hwnd, GW_OWNER)) return TRUE;
  wchar_t title[256] = {0};
  GetWindowTextW(hwnd, title, 255);
  if (!title[0]) return TRUE;
  target_window = hwnd;
  return FALSE;
}

int main(int argc, char** argv) {
  if (argc < 3) { printf("usage: inject-hook.exe <pid> <dll>\n"); return 2; }
  target_pid = (DWORD)strtoul(argv[1], NULL, 10);
  HMODULE dll = LoadLibraryA(argv[2]);
  if (!dll) { printf("LoadLibrary failed %lu\n", GetLastError()); return 3; }
  HOOKPROC proc = (HOOKPROC)GetProcAddress(dll, "XiaoyuCommentHookProc");
  if (!proc) { printf("export missing\n"); return 4; }
  EnumWindows(find_window, 0);
  if (!target_window) { printf("no visible window for pid %lu\n", target_pid); return 5; }
  DWORD tid = GetWindowThreadProcessId(target_window, NULL);
  HHOOK hook = SetWindowsHookExW(WH_GETMESSAGE, proc, dll, tid);
  if (!hook) { printf("SetWindowsHookEx failed %lu\n", GetLastError()); return 6; }
  PostThreadMessageW(tid, WM_NULL, 0, 0);
  Sleep(3000);
  UnhookWindowsHookEx(hook);
  printf("{\"pid\":%lu,\"hwnd\":%lld,\"tid\":%lu,\"hook\":%lld}\n", target_pid, (long long)target_window, tid, (long long)hook);
  return 0;
}
