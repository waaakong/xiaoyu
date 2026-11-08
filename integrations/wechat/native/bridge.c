// Independent, exact-build text transport. No inline hooks or proxy DLLs.
// The host verifies full Authenticode/version/SHA-256 before loading this DLL.
#define WIN32_LEAN_AND_MEAN
#include <winsock2.h>
#include <windows.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <wchar.h>
#include "profile.h"

typedef struct { uint32_t magic,pid,port,max_submissions; char token[65],account[129]; } StartConfig;
typedef struct { uint32_t magic; char id[36]; uint32_t peer_len,text_len; } Request;
typedef struct { void *object; uintptr_t pid,handle; ULONG access; USHORT trace,kind; ULONG attributes,reserved; } HandleEntry;
typedef LONG (WINAPI *QuerySystem)(ULONG,void*,ULONG,ULONG*);
static StartConfig config;
static HMODULE self_module;
static HANDLE server_thread;
static SOCKET listener=INVALID_SOCKET;
static volatile LONG running,submissions;
static volatile LONG64 operation_counter;
static uint64_t operation_prefix;
static unsigned char *core;
static char seen[128][36];
static unsigned seen_count;
#ifdef XY_OFFLINE_TEST
static int test_verified=1;
__declspec(dllexport) void XiaoyuTestVerified(int value) {test_verified=value;}
#endif

__declspec(dllexport) int XiaoyuValidate(const void *buffer,unsigned size) {
    if(size<sizeof(Request)) return 0;
    const Request *r=buffer;
    if(r->magic!=0x314e5958 || !r->peer_len || r->peer_len>128 || !r->text_len || r->text_len>3000 ||
       size!=sizeof(Request)+r->peer_len+r->text_len) return 0;
    for(unsigned i=0;i<36;i++) if(i==8||i==13||i==18||i==23) {if(r->id[i]!='-') return 0;}
        else if(!((r->id[i]>='0'&&r->id[i]<='9')||(r->id[i]>='a'&&r->id[i]<='f'))) return 0;
    const char *peer=(const char*)buffer+sizeof(Request),*text=peer+r->peer_len;
    for(unsigned i=0;i<r->peer_len;i++) if(!((peer[i]>='a'&&peer[i]<='z')||(peer[i]>='A'&&peer[i]<='Z')||
       (peer[i]>='0'&&peer[i]<='9')||peer[i]=='_'||peer[i]=='@'||peer[i]=='.'||peer[i]=='-')) return 0;
    if(memchr(text,0,r->text_len)) return 0;
    return MultiByteToWideChar(CP_UTF8,MB_ERR_INVALID_CHARS,text,r->text_len,NULL,0)>0;
}

static int exact_build(void) {
#ifdef XY_OFFLINE_TEST
    return test_verified;
#else
    core=(unsigned char*)GetModuleHandleW(L"Weixin.dll");
    if(!core) return 0;
    IMAGE_DOS_HEADER *dos=(IMAGE_DOS_HEADER*)core;
    if(dos->e_magic!=IMAGE_DOS_SIGNATURE || dos->e_lfanew<64 || dos->e_lfanew>4096) return 0;
    IMAGE_NT_HEADERS64 *nt=(IMAGE_NT_HEADERS64*)(core+dos->e_lfanew);
    if(nt->Signature!=IMAGE_NT_SIGNATURE || nt->FileHeader.Machine!=IMAGE_FILE_MACHINE_AMD64 ||
       nt->OptionalHeader.SizeOfImage!=XY_IMAGE_SIZE) return 0;
    for(unsigned i=0;i<sizeof(checks)/sizeof(checks[0]);i++)
        if(memcmp(core+checks[i].rva,checks[i].bytes,checks[i].size)) return 0;
    return 1;
#endif
}

// Same evidence as the external reader: exactly one account with open DB files.
// Querying our own handles never duplicates/closes a WeChat handle.
static int account_verified(void) {
#ifdef XY_OFFLINE_TEST
    return test_verified;
#else
    QuerySystem query=(QuerySystem)GetProcAddress(GetModuleHandleW(L"ntdll.dll"),"NtQuerySystemInformation");
    if(!query) return 0;
    ULONG size=1<<20,needed=0; void *data=NULL; LONG status;
    do {
        if(data) HeapFree(GetProcessHeap(),0,data);
        data=HeapAlloc(GetProcessHeap(),0,size); if(!data) return 0;
        status=query(64,data,size,&needed);
        if(status==0) break;
        if((ULONG)status!=0xc0000004) {HeapFree(GetProcessHeap(),0,data);return 0;}
        size=needed+65536>size*2?needed+65536:size*2;
    } while(size<=64*1024*1024);
    if(status || *(uintptr_t*)data>(size-16)/sizeof(HandleEntry)) {HeapFree(GetProcessHeap(),0,data);return 0;}
    uintptr_t count=*(uintptr_t*)data; HandleEntry *entries=(HandleEntry*)((char*)data+16);
    int matched=0,invalid=0; wchar_t expected[129];
    if(!MultiByteToWideChar(CP_UTF8,MB_ERR_INVALID_CHARS,config.account,-1,expected,129)) invalid=1;
    for(uintptr_t i=0;i<count&&!invalid;i++) {
        if(entries[i].pid!=GetCurrentProcessId()) continue;
        HANDLE handle=(HANDLE)entries[i].handle;
        if(GetFileType(handle)!=FILE_TYPE_DISK) continue;
        wchar_t path[2048]; DWORD length=GetFinalPathNameByHandleW(handle,path,2048,0);
        if(!length || length>=2048) continue;
        _wcslwr(path);
        wchar_t *folder=wcsstr(path,L"\\xwechat_files\\");
        if(!folder || !wcsstr(folder,L"\\db_storage\\")) continue;
        wchar_t *suffix=wcsrchr(path,L'.');
        if(!suffix || (wcscmp(suffix,L".db")&&wcscmp(suffix,L".db-wal")&&wcscmp(suffix,L".db-shm"))) continue;
        folder+=15; wchar_t *end=wcschr(folder,L'\\');
        if(!end || wcsncmp(end,L"\\db_storage\\",12)) continue;
        *end=0;
        if(_wcsicmp(folder,expected)) invalid=1; else matched++;
    }
    HeapFree(GetProcessHeap(),0,data);
    return matched>0 && !invalid;
#endif
}

static void release_shared(void *control) {
    if(!control) return;
    if(InterlockedDecrement((LONG*)((char*)control+8))==0) {
        void **vtable=*(void***)control;
        ((void(*)(void*))vtable[0])(control);
        if(InterlockedDecrement((LONG*)((char*)control+12))==0) ((void(*)(void*))vtable[1])(control);
    }
}

static void string_set(void *destination,const char *text,size_t length) {
    // Constructor leaves both destination strings empty. Use WeChat's allocator,
    // and keep allocations below the MSVC large-allocation alignment threshold.
    size_t capacity=length<16?15:(length|15);
    char *buffer=destination;
    if(length>=16) {
        buffer=((void*(*)(size_t))(core+XY_ALLOCATE))(capacity+1);
        *(char**)destination=buffer;
    }
    memcpy(buffer,text,length);buffer[length]=0;
    ((uint64_t*)destination)[2]=length;((uint64_t*)destination)[3]=capacity;
}

static int native_send(const Request *r) {
#ifdef XY_OFFLINE_TEST
    return 1;
#else
    void *shared[2]={0};
    unsigned char params[0xe8]={0},callbacks[3][64]={{0}};
    // All jobs retain only native code/data, so stopping this server doesn't
    // leave a callback into an unloaded Xiaoyu DLL.
    ((void(*)(void*))(core+XY_FACTORY))(shared);
    if(!shared[0]||!shared[1]) return 0;
    unsigned char *message=shared[0]; const char *peer=(const char*)(r+1),*text=peer+r->peer_len;
    string_set(message+0xb0,peer,r->peer_len);
    string_set(message+0x758,text,r->text_len);
    *(uint32_t*)(message+0x118)=1;
    *(uint64_t*)(message+0x1c8)=MultiByteToWideChar(CP_UTF8,MB_ERR_INVALID_CHARS,text,r->text_len,NULL,0);
    uint64_t cancel[2]={0};
    // Keep our operations in a private positive int64 namespace. Do not race
    // WeChat's non-atomic GUI counter or modify any client global variable.
    uint64_t operation=operation_prefix|(uint64_t)InterlockedIncrement64(&operation_counter);
    ((void(*)(void*,void*,void*,void*,void*,uint64_t))(core+XY_PARAMS))(
        params,callbacks[0],callbacks[1],callbacks[2],cancel,operation);
    uint64_t callable[5]={(uint64_t)(core+XY_VECTOR_VTABLE),(uint64_t)shared,(uint64_t)(shared+2),(uint64_t)(shared+2),1};
    ((void(*)(void*,void*))(core+XY_SEND))(callable,params);
    // The native send wrapper copies its vector/parameters into its queued job.
    release_shared(*(void**)(params+8));
    release_shared(shared[1]);
    return 1;
#endif
}

static void respond(SOCKET socket,int status,const char *body) {
    char header[256];int size=snprintf(header,sizeof(header),"HTTP/1.1 %d Result\r\nContent-Type: application/json\r\nContent-Length: %zu\r\nConnection: close\r\nCache-Control: no-store\r\n\r\n",status,strlen(body));
    send(socket,header,size,0);send(socket,body,(int)strlen(body),0);
}

static char *header_value(char *buffer,int header_size,const char *name) {
    char *line=strstr(buffer,"\r\n"),*found=NULL;size_t size=strlen(name);
    if(!line)return NULL;line+=2;
    while(line<buffer+header_size-2) {
        char *end=strstr(line,"\r\n");if(!end||end>buffer+header_size)return NULL;
        if((size_t)(end-line)>size&&line[size]==':'&&!_strnicmp(line,name,size)) {
            if(found)return NULL;found=line+size+1;while(found<end&&(*found==' '||*found=='\t'))found++;
        }
        line=end+2;
    }
    return found;
}

static void request(SOCKET socket) {
    char buffer[16385];int size=0,header_size=0,body_size=-1;
    DWORD timeout=2000;setsockopt(socket,SOL_SOCKET,SO_RCVTIMEO,(char*)&timeout,sizeof(timeout));
    while(size<16384) {
        int got=recv(socket,buffer+size,16384-size,0);if(got<=0) return;
        size+=got;buffer[size]=0;
        char *end=strstr(buffer,"\r\n\r\n");
        if(end) {header_size=(int)(end-buffer)+4;break;}
    }
    if(!header_size||header_size>4096||header_value(buffer,header_size,"Origin")||header_value(buffer,header_size,"Transfer-Encoding")) {respond(socket,400,"{}");return;}
    char *authorization=header_value(buffer,header_size,"Authorization");
    if(!authorization || authorization+73>buffer+header_size || strncmp(authorization,"Bearer ",7)) {respond(socket,401,"{}");return;}
    authorization+=7;unsigned difference=0;
    for(int i=0;i<64;i++)difference|=(unsigned char)authorization[i]^(unsigned char)config.token[i];
    if(difference||authorization[64]!='\r'||authorization[65]!='\n'){respond(socket,401,"{}");return;}
    if(!strncmp(buffer,"GET /health HTTP/1.1\r\n",22)) {
        char body[512];int valid=exact_build()&&account_verified();
        snprintf(body,sizeof(body),"{\"integration\":\"XiaoyuNative-1\",\"version\":\"4.2.0.13\",\"pid\":%lu,\"accountDirectory\":\"%s\",\"verified\":%s,\"submissionLimit\":%u,\"submissions\":%ld}",GetCurrentProcessId(),config.account,valid?"true":"false",config.max_submissions,submissions);
        respond(socket,valid?200:409,body);return;
    }
    if(strncmp(buffer,"POST /send HTTP/1.1\r\n",21)) {respond(socket,404,"{}");return;}
    char *length=header_value(buffer,header_size,"Content-Length");
    if(!length || length>=buffer+header_size) {respond(socket,400,"{}");return;}
    char *after;long value=strtol(length,&after,10);
    if(after>=buffer+header_size || strncmp(after,"\r\n",2)||value<48||value>3200) {respond(socket,400,"{}");return;}
    body_size=(int)value;
    while(size<header_size+body_size) {int got=recv(socket,buffer+size,16384-size,0);if(got<=0)return;size+=got;}
    Request *r=(Request*)(buffer+header_size);
    if(size!=header_size+body_size || !XiaoyuValidate(r,body_size)) {respond(socket,400,"{}");return;}
    // One-submission acceptance mode permits only the account's own filehelper.
    if(config.max_submissions==1 && (r->peer_len!=10||memcmp(r+1,"filehelper",10))) {respond(socket,403,"{}");return;}
    for(unsigned i=0;i<seen_count&&i<128;i++) if(!memcmp(seen[i],r->id,36)) {respond(socket,409,"{\"state\":\"already-attempted\"}");return;}
    if(submissions>=(LONG)config.max_submissions || !exact_build() || !account_verified()) {respond(socket,409,"{}");return;}
    memcpy(seen[seen_count++%128],r->id,36);InterlockedIncrement(&submissions);
    int accepted=0;
    __try {accepted=native_send(r);} __except(EXCEPTION_EXECUTE_HANDLER) {accepted=0;}
    respond(socket,accepted?200:500,accepted?"{\"state\":\"submitted\"}":"{\"state\":\"unknown\"}");
}

static DWORD WINAPI serve(void *unused) {
    while(running) {
        SOCKET socket=accept(listener,NULL,NULL);if(socket==INVALID_SOCKET)break;
        request(socket);shutdown(socket,SD_SEND);
        // Drain a bounded rejected body before close, so Windows preserves the
        // HTTP refusal instead of replacing it with a TCP reset.
        char discard[512];int drained=0,got;
        while(drained<16384&&(got=recv(socket,discard,sizeof(discard),0))>0)drained+=got;
        closesocket(socket);
    }
    return 0;
}

__declspec(dllexport) DWORD WINAPI XiaoyuStart(void *argument) {
    if(running||server_thread||!argument) return 1;
    StartConfig *input=argument;
    if(input->magic!=0x314e5958 || input->pid!=GetCurrentProcessId() || input->port<1024 || input->port>65535 ||
       !input->max_submissions || input->max_submissions>100000 || input->token[64] || input->account[128]) return 2;
    for(int i=0;i<64;i++) if(!((input->token[i]>='a'&&input->token[i]<='f')||(input->token[i]>='0'&&input->token[i]<='9')))return 2;
    if(!input->account[0] || strspn(input->account,"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-")!=strlen(input->account))return 2;
    config=*input;
    char prefix[13];memcpy(prefix,config.token,12);prefix[12]=0;
    operation_prefix=((strtoull(prefix,NULL,16)&0x1fffffffffffULL)|0x200000000000ULL)<<17;
    if(!exact_build()||!account_verified()) return 3;
    WSADATA data;if(WSAStartup(MAKEWORD(2,2),&data))return 4;
    listener=socket(AF_INET,SOCK_STREAM,IPPROTO_TCP);if(listener==INVALID_SOCKET){WSACleanup();return 4;}
    BOOL exclusive=TRUE;setsockopt(listener,SOL_SOCKET,SO_EXCLUSIVEADDRUSE,(char*)&exclusive,sizeof(exclusive));
    struct sockaddr_in address={0};address.sin_family=AF_INET;address.sin_addr.s_addr=htonl(INADDR_LOOPBACK);address.sin_port=htons((u_short)config.port);
    if(bind(listener,(struct sockaddr*)&address,sizeof(address))||listen(listener,4)){closesocket(listener);listener=INVALID_SOCKET;WSACleanup();return 4;}
    running=1;server_thread=CreateThread(NULL,0,serve,NULL,0,NULL);
    if(!server_thread){running=0;closesocket(listener);listener=INVALID_SOCKET;WSACleanup();return 4;}
    return 0;
}

__declspec(dllexport) DWORD WINAPI XiaoyuStop(void *unused) {
    if(!server_thread)return 0;
    running=0;if(listener!=INVALID_SOCKET){shutdown(listener,SD_BOTH);closesocket(listener);listener=INVALID_SOCKET;}
    if(WaitForSingleObject(server_thread,5000)!=WAIT_OBJECT_0)return 1;
    CloseHandle(server_thread);server_thread=NULL;WSACleanup();return 0;
}

BOOL WINAPI DllMain(HINSTANCE instance,DWORD reason,void *reserved) {
    if(reason==DLL_PROCESS_ATTACH){self_module=instance;DisableThreadLibraryCalls(instance);}return TRUE;
}
