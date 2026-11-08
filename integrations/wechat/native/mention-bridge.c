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
#include <bcrypt.h>
#include "profile.h"

typedef struct { uint32_t magic,bytes,pid,port,max_submissions,media_mask; char token[65],account[129]; wchar_t media_root[512]; } StartConfig;
typedef struct { uint32_t magic; char id[36]; uint32_t peer_len,text_len; } Request;
typedef struct { uint32_t magic; char id[36]; uint32_t peer_len,text_len,member_len; } MentionRequest;
typedef struct { uint32_t magic; char id[36]; uint32_t kind,peer_len,name_len,file_len; uint64_t bytes; unsigned char sha256[32]; } MediaRequest;
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
static wchar_t media_root[1024];
#ifdef XY_OFFLINE_TEST
static int test_verified=1;
static unsigned test_calls;
__declspec(dllexport) void XiaoyuTestVerified(int value) {test_verified=value;}
__declspec(dllexport) unsigned XiaoyuTestCalls(void) {return test_calls;}
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

static int valid_uuid(const char *id) {
    for(int i=0;i<36;i++)if(i==8||i==13||i==18||i==23){if(id[i]!='-')return 0;}
        else if(!((id[i]>='0'&&id[i]<='9')||(id[i]>='a'&&id[i]<='f')))return 0;
    return 1;
}

__declspec(dllexport) int XiaoyuValidateMedia(const void *buffer,unsigned size) {
    if(size<sizeof(MediaRequest))return 0;const MediaRequest *r=buffer;
    if(r->magic!=0x324d5958||!valid_uuid(r->id)||r->kind<1||r->kind>4||!r->peer_len||r->peer_len>128||
       !r->name_len||r->name_len>240||r->file_len<38||r->file_len>48||!r->bytes||r->bytes>20*1024*1024||
       size!=sizeof(MediaRequest)+r->peer_len+r->name_len+r->file_len)return 0;
    if((r->kind==1&&r->bytes>6*1024*1024)||(r->kind==2&&r->bytes>1024*1024))return 0;
    const char *peer=(const char*)(r+1),*name=peer+r->peer_len,*file=name+r->name_len;
    for(unsigned i=0;i<r->peer_len;i++)if(!((peer[i]>='a'&&peer[i]<='z')||(peer[i]>='A'&&peer[i]<='Z')||
       (peer[i]>='0'&&peer[i]<='9')||peer[i]=='_'||peer[i]=='@'||peer[i]=='.'||peer[i]=='-'))return 0;
    for(unsigned i=0;i<r->name_len;i++)if((unsigned char)name[i]<32||strchr("/\\:",name[i]))return 0;
    if(!MultiByteToWideChar(CP_UTF8,MB_ERR_INVALID_CHARS,name,r->name_len,NULL,0)||!valid_uuid(file)||file[36]!='.')return 0;
    for(unsigned i=37;i<r->file_len;i++)if(!((file[i]>='a'&&file[i]<='z')||(file[i]>='0'&&file[i]<='9')))return 0;
    if(r->kind==1&&!(r->file_len==40&&(!memcmp(file+37,"png",3)||!memcmp(file+37,"jpg",3))))return 0;
    if(r->kind==2&&!(r->file_len==40&&!memcmp(file+37,"gif",3)))return 0;
    if(r->kind==4&&!(r->file_len==40&&!memcmp(file+37,"mp4",3)))return 0;
    return 1;
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

__declspec(dllexport) int XiaoyuValidateMention(const void *buffer,unsigned size) {
    if(size<sizeof(MentionRequest))return 0;const MentionRequest *r=buffer;
    if(r->magic!=0x334e5958||!valid_uuid(r->id)||r->peer_len<10||r->peer_len>128||!r->text_len||r->text_len>3000||!r->member_len||r->member_len>128||size!=sizeof(MentionRequest)+r->peer_len+r->text_len+r->member_len)return 0;
    const char *peer=(const char*)(r+1),*text=peer+r->peer_len,*member=text+r->text_len;
    if(memcmp(peer+r->peer_len-9,"@chatroom",9)||r->member_len==3&&!memcmp(member,"all",3))return 0;
    for(unsigned i=0;i<r->peer_len;i++)if(!((peer[i]>='a'&&peer[i]<='z')||(peer[i]>='A'&&peer[i]<='Z')||(peer[i]>='0'&&peer[i]<='9')||peer[i]=='_'||peer[i]=='@'||peer[i]=='.'||peer[i]=='-'))return 0;
    for(unsigned i=0;i<r->member_len;i++)if(!((member[i]>='a'&&member[i]<='z')||(member[i]>='A'&&member[i]<='Z')||(member[i]>='0'&&member[i]<='9')||member[i]=='_'||member[i]=='-'))return 0;
    return !memchr(text,0,r->text_len)&&MultiByteToWideChar(CP_UTF8,MB_ERR_INVALID_CHARS,text,r->text_len,NULL,0)>0;
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

static int queue_native(void *shared[2]) {
#ifdef XY_OFFLINE_TEST
    return 1;
#else
    unsigned char params[0xe8]={0},callbacks[3][64]={{0}};
    // All jobs retain only native code/data, so stopping this server doesn't
    // leave a callback into an unloaded Xiaoyu DLL.
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

static int native_mention(const MentionRequest *r) {
#ifdef XY_OFFLINE_TEST
    test_calls++;return 1;
#else
    void *shared[2]={0};((void(*)(void*))(core+XY_FACTORY))(shared);if(!shared[0]||!shared[1])return 0;
    unsigned char *message=shared[0];const char *peer=(const char*)(r+1),*text=peer+r->peer_len,*member=text+r->text_len;
    string_set(message+0xb0,peer,r->peer_len);string_set(message+0x758,text,r->text_len);
    // The exact-build constructor initializes this second std::string at 0x778.
    // The corresponding 4.1.10.27 TextMessage source names the field atlist.
    string_set(message+0x778,member,r->member_len);
    *(uint32_t*)(message+0x118)=1;*(uint64_t*)(message+0x1c8)=MultiByteToWideChar(CP_UTF8,MB_ERR_INVALID_CHARS,text,r->text_len,NULL,0);
    return queue_native(shared);
#endif
}

static int native_send(const Request *r) {
#ifdef XY_OFFLINE_TEST
    test_calls++;
    return 1;
#else
    void *shared[2]={0};((void(*)(void*))(core+XY_FACTORY))(shared);
    if(!shared[0]||!shared[1])return 0;
    unsigned char *message=shared[0];const char *peer=(const char*)(r+1),*text=peer+r->peer_len;
    string_set(message+0xb0,peer,r->peer_len);string_set(message+0x758,text,r->text_len);
    *(uint32_t*)(message+0x118)=1;
    *(uint64_t*)(message+0x1c8)=MultiByteToWideChar(CP_UTF8,MB_ERR_INVALID_CHARS,text,r->text_len,NULL,0);
    return queue_native(shared);
#endif
}

static int hash_file(HANDLE file,unsigned char result[32]) {
    BCRYPT_ALG_HANDLE algorithm=NULL;BCRYPT_HASH_HANDLE hash=NULL;int ok=0;
    if(BCryptOpenAlgorithmProvider(&algorithm,BCRYPT_SHA256_ALGORITHM,NULL,0))return 0;
    if(BCryptCreateHash(algorithm,&hash,NULL,0,NULL,0,0))goto end;
    unsigned char bytes[65536];DWORD read;
    do{if(!ReadFile(file,bytes,sizeof(bytes),&read,NULL))goto end;if(read&&BCryptHashData(hash,bytes,read,0))goto end;}while(read);
    ok=BCryptFinishHash(hash,result,32,0)==0;
    end:if(hash)BCryptDestroyHash(hash);BCryptCloseAlgorithmProvider(algorithm,0);return ok;
}

static int native_media(const MediaRequest *r) {
    const char *peer=(const char*)(r+1),*name=peer+r->peer_len,*relative=name+r->name_len;
    wchar_t filename[64],full[1024],resolved[1024];
    if(!MultiByteToWideChar(CP_UTF8,MB_ERR_INVALID_CHARS,relative,r->file_len,filename,64))return 0;filename[r->file_len]=0;
    if(swprintf(full,1024,L"%ls\\%ls",config.media_root,filename)<0)return 0;
    HANDLE file=CreateFileW(full,GENERIC_READ,FILE_SHARE_READ,NULL,OPEN_EXISTING,FILE_ATTRIBUTE_NORMAL,NULL);
    if(file==INVALID_HANDLE_VALUE)return 0;int accepted=0;LARGE_INTEGER length;unsigned char hash[32];
    DWORD chars=GetFinalPathNameByHandleW(file,resolved,1024,0);
    if(!chars||chars>=1024||_wcsnicmp(resolved,media_root,wcslen(media_root))||resolved[wcslen(media_root)]!=L'\\'||
       !GetFileSizeEx(file,&length)||(uint64_t)length.QuadPart!=r->bytes||!hash_file(file,hash)||memcmp(hash,r->sha256,32))goto end;
#ifdef XY_OFFLINE_TEST
    test_calls++;accepted=1;
#else
    void *shared[2]={0};((void(*)(void*))(core+(r->kind==2?XY_EMOJI_FACTORY:XY_FILE_FACTORY)))(shared);
    if(!shared[0]||!shared[1]||shared[0]!=(char*)shared[1]+16||
       *(uintptr_t*)shared[0]!=(uintptr_t)(core+(r->kind==2?XY_EMOJI_BODY:XY_FILE_BODY))||
       *(uintptr_t*)shared[1]!=(uintptr_t)(core+(r->kind==2?XY_EMOJI_OWNER:XY_FILE_OWNER)))goto end;
    unsigned char *message=shared[0];string_set(message+0xb0,peer,r->peer_len);
    // The current common input base owns a UTF-16 path at +0x120.
    size_t path_length=wcslen(full),capacity=path_length<8?7:(path_length|7);
    wchar_t *path_buffer=(wchar_t*)(message+0x120);
    if(path_length>=8){path_buffer=((void*(*)(size_t))(core+XY_ALLOCATE))((capacity+1)*sizeof(wchar_t));*(wchar_t**)(message+0x120)=path_buffer;}
    memcpy(path_buffer,full,(path_length+1)*sizeof(wchar_t));*(uint64_t*)(message+0x130)=path_length;*(uint64_t*)(message+0x138)=capacity;
    *(uint32_t*)(message+0x118)=r->kind==1?3:r->kind==4?43:49;
    *(uint32_t*)(message+0x11c)=r->kind==2?8:r->kind==3?6:0;
    string_set(message+0x1a8,name,r->name_len);*(uint64_t*)(message+0x1c8)=r->bytes;
    accepted=queue_native(shared);
#endif
    end:CloseHandle(file);return accepted;
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

#ifdef XY_VOICE_ONLY
#include "voice-transport.h"
#endif
static void request(SOCKET socket) {
#ifdef XY_VOICE_ONLY
    voice_request(socket);return;
#else
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
        char body[768];int valid=exact_build()&&account_verified();
        snprintf(body,sizeof(body),"{\"integration\":\"XiaoyuNative-1\",\"nativeProtocol\":2,\"nativeMentionSend\":%s,\"version\":\"4.2.0.13\",\"pid\":%lu,\"accountDirectory\":\"%s\",\"verified\":%s,\"submissionLimit\":%u,\"submissions\":%ld,\"mediaMask\":%u,\"capabilities\":{\"images\":%s,\"stickers\":%s,\"files\":%s,\"videos\":%s,\"voice\":false}}",config.media_mask&16?"true":"false",GetCurrentProcessId(),config.account,valid?"true":"false",config.max_submissions,submissions,config.media_mask,config.media_mask&1?"true":"false",config.media_mask&2?"true":"false",config.media_mask&4?"true":"false",config.media_mask&8?"true":"false");
        respond(socket,valid?200:409,body);return;
    }
    int media=!strncmp(buffer,"POST /media HTTP/1.1\r\n",22),mention=!strncmp(buffer,"POST /send-at HTTP/1.1\r\n",24);
    if(!media&&!mention&&strncmp(buffer,"POST /send HTTP/1.1\r\n",21)) {respond(socket,404,"{}");return;}
    char *length=header_value(buffer,header_size,"Content-Length");
    if(!length || length>=buffer+header_size) {respond(socket,400,"{}");return;}
    char *after;long value=strtol(length,&after,10);
    if(after>=buffer+header_size || strncmp(after,"\r\n",2)||value<(media?96:mention?52:48)||value>(mention?3400:3200)) {respond(socket,400,"{}");return;}
    body_size=(int)value;
    while(size<header_size+body_size) {int got=recv(socket,buffer+size,16384-size,0);if(got<=0)return;size+=got;}
    Request *r=(Request*)(buffer+header_size);
    if(size!=header_size+body_size || !(media?XiaoyuValidateMedia(r,body_size):mention?XiaoyuValidateMention(r,body_size):XiaoyuValidate(r,body_size))) {respond(socket,400,"{}");return;}
    MediaRequest *mr=(MediaRequest*)r;
    const char *peer=media?(const char*)(mr+1):mention?(const char*)((MentionRequest*)r+1):(const char*)(r+1);
    if(mention&&!(config.media_mask&16)){respond(socket,403,"{\"state\":\"mention-not-enabled\"}");return;}
    unsigned peer_length=media?mr->peer_len:r->peer_len;
    if(media&&!(config.media_mask&(1u<<(mr->kind-1)))){respond(socket,403,"{\"state\":\"media-not-enabled\"}");return;}
    // One-submission acceptance mode permits only the account's own filehelper.
    if(config.max_submissions==1 && (peer_length!=10||memcmp(peer,"filehelper",10))) {respond(socket,403,"{}");return;}
    for(unsigned i=0;i<seen_count&&i<128;i++) if(!memcmp(seen[i],r->id,36)) {respond(socket,409,"{\"state\":\"already-attempted\"}");return;}
    if(submissions>=(LONG)config.max_submissions || !exact_build() || !account_verified()) {respond(socket,409,"{}");return;}
    memcpy(seen[seen_count++%128],r->id,36);InterlockedIncrement(&submissions);
    int accepted=0;
    __try {accepted=media?native_media(mr):mention?native_mention((MentionRequest*)r):native_send(r);} __except(EXCEPTION_EXECUTE_HANDLER) {accepted=0;}
    respond(socket,accepted?200:500,accepted?"{\"state\":\"submitted\"}":"{\"state\":\"unknown\"}");
#endif
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
#ifdef XY_VOICE_ONLY
    if(input->magic!=0x31565958||input->media_mask!=1)return 2;
#else
    if(input->magic!=0x324d5958)return 2;
#endif
    if(input->bytes!=sizeof(StartConfig)||input->pid!=GetCurrentProcessId() || input->port<1024 || input->port>65535 ||
       !input->max_submissions || input->max_submissions>100000 || input->media_mask>31 ||input->token[64] || input->account[128]||input->media_root[511]) return 2;
    for(int i=0;i<64;i++) if(!((input->token[i]>='a'&&input->token[i]<='f')||(input->token[i]>='0'&&input->token[i]<='9')))return 2;
    if(!input->account[0] || strspn(input->account,"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-")!=strlen(input->account))return 2;
    config=*input;
    if(config.media_mask){
        HANDLE directory=CreateFileW(config.media_root,FILE_READ_ATTRIBUTES,FILE_SHARE_READ|FILE_SHARE_WRITE|FILE_SHARE_DELETE,NULL,OPEN_EXISTING,FILE_FLAG_BACKUP_SEMANTICS,NULL);
        if(directory==INVALID_HANDLE_VALUE)return 2;
        DWORD chars=GetFinalPathNameByHandleW(directory,media_root,1024,0);CloseHandle(directory);
        if(!chars||chars>=1024)return 2;
        while(chars&&media_root[chars-1]==L'\\')media_root[--chars]=0;
    }
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
