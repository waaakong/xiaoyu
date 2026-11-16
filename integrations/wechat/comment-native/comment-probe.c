// Constructor/parser-only experiment. No dispatch, hooks, network, messages or file access.
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <stdint.h>
#include <string.h>
#include "profile.h"
typedef struct {uint32_t magic,pid,length,reserved;unsigned char data[1024];} Probe;
__declspec(dllexport) DWORD WINAPI XiaoyuCommentProbe(void *input){
 Probe *p=input;if(!p||p->magic!=0x31504358||p->pid!=GetCurrentProcessId()||!p->length||p->length>1024||p->reserved)return 1;
 unsigned char *core=(unsigned char*)GetModuleHandleW(L"Weixin.dll");if(!core)return 2;
 IMAGE_DOS_HEADER *dos=(IMAGE_DOS_HEADER*)core;if(dos->e_magic!=IMAGE_DOS_SIGNATURE||dos->e_lfanew<64||dos->e_lfanew>4096)return 3;
 IMAGE_NT_HEADERS64 *nt=(IMAGE_NT_HEADERS64*)(core+dos->e_lfanew);if(nt->Signature!=IMAGE_NT_SIGNATURE||nt->FileHeader.Machine!=IMAGE_FILE_MACHINE_AMD64||nt->OptionalHeader.SizeOfImage!=XY_IMAGE_SIZE)return 4;
 for(unsigned i=0;i<sizeof(checks)/sizeof(checks[0]);i++)if(memcmp(core+checks[i].rva,checks[i].bytes,32))return 5;
 uintptr_t expected[6]={0x315a5f0,0x10acb00,0x7b3e70,0x115010,0x7b3eb0,1};uintptr_t *vt=(uintptr_t*)(core+0x96ff848);
 for(unsigned i=0;i<6;i++)if(vt[i]!=(i==5?expected[i]:(uintptr_t)(core+expected[i])))return 6;
 void *memory=((void*(*)(size_t))(core+0x76a750c))(0xf0);if(!memory)return 7;
 unsigned char info[64]={0};memcpy(info,core+0x96fc9d0,16);*(uint32_t*)(info+16)=213;
 char endpoint[64]="/cgi-bin/micromsg-bin/mmsnscomment";*(void**)(info+24)=endpoint;*(uint64_t*)(info+40)=strlen(endpoint);*(uint64_t*)(info+48)=63;info[56]=1;
 ((void(*)(void*,void*))(core+0x315a420))(memory,info);
 if(*(uintptr_t**)memory!=vt)return 8; // Unknown constructor state: never guess a destructor.
 void *request=(char*)memory+0xa8;
 unsigned char parsed=((unsigned char(*)(void*,const void*,int))(core+0x6abe50))(request,p->data,p->length);
 uintptr_t *proto=*(uintptr_t**)request;if(proto!=(uintptr_t*)(core+0x9b3d008))return 9;
 unsigned char initialized=parsed?((unsigned char(*)(void*))proto[4])(request):0;
 ((void*(*)(void*,unsigned))vt[0])(memory,1);
 return 0x100|(parsed?0x10:0)|(initialized?1:0);
}
BOOL WINAPI DllMain(HINSTANCE module,DWORD reason,LPVOID unused){(void)unused;if(reason==DLL_PROCESS_ATTACH)DisableThreadLibraryCalls(module);return TRUE;}
