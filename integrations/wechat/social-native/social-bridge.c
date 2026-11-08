// Exact-build, separately loaded experimental social transport.
// No inline hooks, client-file patches, credential exports or voice sending.
// Native asynchronous callbacks remain pinned until WeChat exits. At most three
// test submissions are admitted; owned task storage is deliberately retained.
#define WIN32_LEAN_AND_MEAN
#include <winsock2.h>
#include <windows.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <wchar.h>
#include <time.h>
#include "profile.h"
typedef struct {uint32_t magic,bytes,pid,port,limit;char token[65],account[129],wxid[129],pat_group[129],pat_member[129];} StartConfig;
typedef struct {uint32_t magic,kind;char id[36];uint32_t peer_len,payload_len,target_len;} SocialRequest;
typedef struct {void *object;uintptr_t pid,handle;ULONG access;USHORT trace,kind;ULONG attributes,reserved;} HandleEntry;
typedef LONG (WINAPI *QuerySystem)(ULONG,void*,ULONG,ULONG*);
static StartConfig config;static unsigned char *core;static SOCKET listener=INVALID_SOCKET;static volatile LONG running,admitted;
#ifdef XY_OFFLINE_TEST
static int test_verified=1;
static const char *offline_flag="true";
#else
static const char *offline_flag="false";
#endif
#include "identity.h"
typedef struct {unsigned char bytes[65536];unsigned length;int ok;} Buffer;
typedef struct {void *native;unsigned kind;char id[37],peer[129];Buffer request;volatile LONG serialized,response,ret;uint64_t server_id;char response_peer[129],response_client[80];} Job;
static Job jobs[512];static unsigned job_count;
static int readable(const void *p,size_t length){MEMORY_BASIC_INFORMATION m;uintptr_t a=(uintptr_t)p;return p&&length&&VirtualQuery(p,&m,sizeof(m))&&m.State==MEM_COMMIT&&!(m.Protect&(PAGE_NOACCESS|PAGE_GUARD))&&a>=(uintptr_t)m.BaseAddress&&length<=(uintptr_t)m.BaseAddress+m.RegionSize-a;}
static int uuid(const char *v){for(unsigned i=0;i<36;i++)if(i==8||i==13||i==18||i==23){if(v[i]!='-')return 0;}else if(!((v[i]>='0'&&v[i]<='9')||(v[i]>='a'&&v[i]<='f')))return 0;return 1;}
static int identifier(const char *s,unsigned n){if(!n||n>128)return 0;for(unsigned i=0;i<n;i++)if(!((s[i]>='a'&&s[i]<='z')||(s[i]>='A'&&s[i]<='Z')||(s[i]>='0'&&s[i]<='9')||strchr("_@.-",s[i])))return 0;return 1;}
static int contains(const char *s,unsigned n,const char *needle){unsigned k=(unsigned)strlen(needle);for(unsigned i=0;i+k<=n;i++)if(!_strnicmp(s+i,needle,k))return 1;return 0;}
__declspec(dllexport) int XiaoyuSocialValidate(const void *data,unsigned size){
    if(!data||size<sizeof(SocialRequest))return 0;const SocialRequest *r=data;
    if(r->magic!=0x34535958||r->kind<1||r->kind>3||!uuid(r->id)||r->peer_len>128||r->payload_len>32768||r->target_len>128||size!=sizeof(*r)+r->peer_len+r->payload_len+r->target_len)return 0;
    const char *peer=(const char*)(r+1),*body=peer+r->peer_len,*target=body+r->payload_len;if(!identifier(peer,r->peer_len))return 0;
    if(r->kind==3)return !r->payload_len&&identifier(target,r->target_len);
    if(r->target_len||r->payload_len<28||memchr(body,0,r->payload_len)||!MultiByteToWideChar(CP_UTF8,MB_ERR_INVALID_CHARS,body,r->payload_len,NULL,0))return 0;
    if(memcmp(body,"<appmsg>",8)||memcmp(body+r->payload_len-9,"</appmsg>",9)||contains(body,r->payload_len,"<!DOCTYPE")||contains(body,r->payload_len,"<!ENTITY"))return 0;
    return contains(body,r->payload_len,r->kind==1?"<type>57</type>":"<type>19</type>");
}
static void bytes(Buffer *b,const void *p,unsigned n){if(!b->ok||n>sizeof(b->bytes)-b->length){b->ok=0;return;}memcpy(b->bytes+b->length,p,n);b->length+=n;}
static void varint(Buffer *b,uint64_t n){do{unsigned char c=(unsigned char)(n&127);n>>=7;if(n)c|=128;bytes(b,&c,1);}while(n&&b->ok);}
static void number(Buffer *b,unsigned field,uint64_t n){varint(b,(uint64_t)field<<3);varint(b,n);}
static void field(Buffer *b,unsigned key,const void *p,unsigned n){varint(b,((uint64_t)key<<3)|2);varint(b,n);bytes(b,p,n);}
static void string(Buffer *b,unsigned key,const char *p){field(b,key,p,(unsigned)strlen(p));}
static void build_request(Job *j,const SocialRequest *r){
    const char *peer=(const char*)(r+1),*body=peer+r->peer_len,*target=body+r->payload_len;Buffer base={.ok=1};string(&base,1,"");number(&base,2,0);string(&base,3,"Windows");number(&base,4,0);string(&base,5,"Windows");number(&base,6,0);
    j->request.ok=1;field(&j->request,1,base.bytes,base.length);
    if(r->kind==3){string(&j->request,2,config.wxid);field(&j->request,3,peer,r->peer_len);field(&j->request,4,target,r->target_len);field(&j->request,5,r->id,36);number(&j->request,6,0);}
    else{Buffer app={.ok=1};string(&app,1,config.wxid);number(&app,3,0);field(&app,4,peer,r->peer_len);number(&app,5,r->kind==1?57:19);field(&app,6,body,r->payload_len);number(&app,7,(uint64_t)time(NULL));field(&app,8,r->id,36);string(&app,12,"<msgsource><bizflag>0</bizflag></msgsource>");field(&j->request,2,app.bytes,app.length);}
}
__declspec(dllexport) unsigned XiaoyuSocialEncode(const void *data,unsigned size,void *out,unsigned capacity){if(!XiaoyuSocialValidate(data,size))return 0;Job j={0};build_request(&j,data);if(!j.request.ok||j.request.length>capacity)return 0;memcpy(out,j.request.bytes,j.request.length);return j.request.length;}
static Job *job_for(void *task){for(unsigned i=0;i<job_count;i++)if(jobs[i].native==task)return &jobs[i];return NULL;}
static void *task_destroy(void *task,unsigned flags){(void)flags;return task;}
static unsigned char task_serialize(void *task,void *holder,void *unused,unsigned char *valid,void *context){
    (void)unused;(void)context;Job *j=job_for(task);if(!j||!j->request.ok||!readable(holder,8)||!readable(valid,1)||!account_verified()||!exact_build())return 0;MEMORY_BASIC_INFORMATION protection;if(!VirtualQuery(valid,&protection,sizeof(protection))||!(protection.Protect&(PAGE_READWRITE|PAGE_WRITECOPY|PAGE_EXECUTE_READWRITE|PAGE_EXECUTE_WRITECOPY)))return 0;*valid=1;
#ifndef XY_OFFLINE_TEST
    int count=((int(*)(void*,const void*,int))(core+XY_HOLDER_WRITE))(holder,j->request.bytes,(int)j->request.length);
    if(count!=(int)j->request.length)return 0;
#endif
    InterlockedExchange(&j->serialized,1);return 1;
}
static int read_var(const unsigned char *s,unsigned n,unsigned *at,uint64_t *value){uint64_t result=0;for(unsigned k=0;k<10&&*at<n;k++){unsigned char c=s[(*at)++];if(k==9&&c>1)return 0;result|=(uint64_t)(c&127)<<(k*7);if(!(c&128)){*value=result;return 1;}}return 0;}
static int parse_fields(Job *j,const unsigned char *s,unsigned n,int base){unsigned at=0;while(at<n){uint64_t tag,length,value;if(!read_var(s,n,&at,&tag)||!tag)return 0;unsigned key=(unsigned)(tag>>3),wire=(unsigned)(tag&7);if(wire==0){if(!read_var(s,n,&at,&value))return 0;if(base&&key==1)j->ret=(LONG)(uint32_t)value;if(!base&&key==(j->kind==3?5:9))j->server_id=value;}else if(wire==2){if(!read_var(s,n,&at,&length)||length>n-at)return 0;if(!base&&key==1){if(!parse_fields(j,s+at,(unsigned)length,1))return 0;}else if(!base&&j->kind!=3&&(key==4||key==6)){char *out=key==4?j->response_peer:j->response_client;unsigned cap=key==4?sizeof(j->response_peer):sizeof(j->response_client);if(length>=cap||memchr(s+at,0,(size_t)length))return 0;memcpy(out,s+at,(size_t)length);out[length]=0;}at+=(unsigned)length;}else if(wire==1){if(n-at<8)return 0;at+=8;}else if(wire==5){if(n-at<4)return 0;at+=4;}else return 0;}return 1;}
__declspec(dllexport) int XiaoyuSocialParse(const void *data,unsigned size,unsigned kind,uint64_t *server_id,LONG *ret){if(!data||!size||size>16384||kind<1||kind>3||!server_id||!ret)return 0;Job j={0};j.kind=kind;j.ret=0x7fffffff;if(!parse_fields(&j,data,size,0))return 0;*server_id=j.server_id;*ret=j.ret;return 1;}
static unsigned char task_response(void *task,void *holder){
    Job *j=job_for(task);if(!j||!readable(holder,8))return 0;
#ifndef XY_OFFLINE_TEST
    unsigned n=((unsigned(*)(void*))(core+XY_HOLDER_SIZE))(holder);if(!n||n>16384)return 0;void *data=((void*(*)(void*,int))(core+XY_HOLDER_DATA))(holder,0);if(!readable(data,n)||!parse_fields(j,data,n,0))return 0;
#endif
    InterlockedExchange(&j->response,1);return 1;
}
static void *task_inner(void *task){return (char*)task+0xa8;}
static void *task_result(void *task){Job *j=job_for(task);return (char*)task+(j&&j->kind==3?XY_PAT_RESPONSE_OFFSET:0x110);}
static uintptr_t task_table[6]={(uintptr_t)task_destroy,(uintptr_t)task_serialize,(uintptr_t)task_response,(uintptr_t)task_inner,(uintptr_t)task_result,1};
static void *manager(void){
#ifdef XY_OFFLINE_TEST
    return (void*)1;
#else
    void **root=(void**)*(uintptr_t*)(core+XY_ROOT_GLOBAL);if(!readable(root,0x2d0)||root[0]!=core+XY_ROOT_VTABLE)return NULL;
    void **m=(void**)*(uintptr_t*)((char*)root+0x2c8);if(!readable(m,8)||m[0]!=core+XY_MANAGER_VTABLE)return NULL;void **table=m[0];if(!readable(table,48)||table[5]!=core+XY_MANAGER_DISPATCH)return NULL;return m;
#endif
}
static int submit(Job *j){
    if(!exact_build()||!account_verified())return 0;void *m=manager();if(!m)return 0;
#ifdef XY_OFFLINE_TEST
    j->serialized=1;j->response=1;j->ret=0;j->server_id=1234567890123456789ULL;return 1;
#else
    unsigned char *task=VirtualAlloc(NULL,4096,MEM_COMMIT|MEM_RESERVE,PAGE_READWRITE);if(!task)return 0;
    unsigned char info[64]={0};memcpy(info,core+(j->kind==3?XY_PAT_INFO_HEADER:XY_APP_INFO_HEADER),16);const char *endpoint=j->kind==3?"/cgi-bin/micromsg-bin/sendpat":"/cgi-bin/micromsg-bin/sendappmsg";unsigned len=(unsigned)strlen(endpoint);char *owned=VirtualAlloc(NULL,128,MEM_COMMIT|MEM_RESERVE,PAGE_READWRITE);if(!owned)return 0;memcpy(owned,endpoint,len+1);
    *(uint32_t*)(info+16)=j->kind==3?849:222;*(void**)(info+24)=owned;*(uint64_t*)(info+40)=len;*(uint64_t*)(info+48)=127;info[56]=1;
    ((void(*)(void*,void*))(core+(j->kind==3?XY_PAT_TASK_CTOR:XY_APP_TASK_CTOR)))(task,info);j->native=task;*(void***)task=(void**)task_table;
    ((void(*)(void*,void*))(core+XY_MANAGER_DISPATCH))(m,task);return 1;
#endif
}
static void reply(SOCKET s,int status,const char *body){char header[256];int n=snprintf(header,sizeof(header),"HTTP/1.1 %d Result\r\nContent-Type: application/json\r\nCache-Control: no-store\r\nConnection: close\r\nContent-Length: %u\r\n\r\n",status,(unsigned)strlen(body));send(s,header,n,0);send(s,body,(int)strlen(body),0);}
static void serve(SOCKET s){
    char *data=HeapAlloc(GetProcessHeap(),HEAP_ZERO_MEMORY,70000);if(!data)return;unsigned n=0,head=0,length=0;char *end=NULL;while(n<68000){int got=recv(s,data+n,68000-n,0);if(got<=0)goto done;n+=(unsigned)got;data[n]=0;end=strstr(data,"\r\n\r\n");if(end){head=(unsigned)(end-data)+4;break;}}
    if(!head)goto done;char authorization[100];snprintf(authorization,sizeof(authorization),"Authorization: Bearer %s\r\n",config.token);if(!strstr(data,authorization)||strstr(data,"\r\nOrigin:")||strstr(data,"\r\norigin:")){reply(s,403,"{\"error\":\"denied\"}");goto done;}
    if(!strncmp(data,"GET /health ",12)){char out[400];snprintf(out,sizeof(out),"{\"integration\":\"XiaoyuSocial-1\",\"pid\":%lu,\"accountDirectory\":\"%s\",\"experimental\":%s,\"offlineTest\":%s,\"verified\":%s,\"limit\":%u,\"submissions\":%ld,\"voice\":false}",GetCurrentProcessId(),config.account,config.limit<=3?"true":"false",offline_flag,exact_build()&&account_verified()&&manager()?"true":"false",config.limit,admitted);reply(s,200,out);goto done;}
    if(!strncmp(data,"POST /activate ",15)){unsigned mask=0;for(unsigned i=0;i<job_count;i++)if(jobs[i].response&&jobs[i].ret==0&&jobs[i].server_id)mask|=1u<<jobs[i].kind;if(mask!=14){reply(s,409,"{\"error\":\"finite-validation-incomplete\"}");goto done;}config.limit=512;reply(s,200,"{\"active\":true,\"limit\":512}");goto done;}
    if(strncmp(data,"POST /submit ",13)){reply(s,404,"{\"error\":\"route\"}");goto done;}char *cl=strstr(data,"\r\nContent-Length: ");if(!cl){reply(s,400,"{\"error\":\"length\"}");goto done;}length=(unsigned)strtoul(cl+18,NULL,10);if(!length||length>40000||head+length>68000){reply(s,400,"{\"error\":\"length\"}");goto done;}
    while(n<head+length){int got=recv(s,data+n,head+length-n,0);if(got<=0)goto done;n+=(unsigned)got;}SocialRequest *r=(SocialRequest*)(data+head);if(!XiaoyuSocialValidate(r,length)){reply(s,400,"{\"error\":\"payload\"}");goto done;}
    for(unsigned i=0;i<job_count;i++)if(!memcmp(jobs[i].id,r->id,36)){reply(s,409,"{\"error\":\"already-attempted\"}");goto done;}
    char peer[129]={0},target[129]={0};memcpy(peer,r+1,r->peer_len);if(r->target_len)memcpy(target,(char*)(r+1)+r->peer_len+r->payload_len,r->target_len);
    if(config.limit<=3&&((r->kind!=3&&strcmp(peer,"filehelper"))||(r->kind==3&&(strcmp(peer,config.pat_group)||strcmp(target,config.pat_member))))){reply(s,403,"{\"error\":\"finite-test-target\"}");goto done;}
    if(job_count>=config.limit||job_count>=512){reply(s,429,"{\"error\":\"finite-test-limit\"}");goto done;}
    Job *j=&jobs[job_count++];j->kind=r->kind;j->ret=0x7fffffff;memcpy(j->id,r->id,36);strcpy(j->peer,peer);build_request(j,r);InterlockedIncrement(&admitted);if(!j->request.ok||!submit(j)){reply(s,409,"{\"state\":\"not-submitted\"}");goto done;}
    DWORD until=GetTickCount()+8000;while(!j->response&&((LONG)(until-GetTickCount()))>0)Sleep(20);
    char out[512];snprintf(out,sizeof(out),"{\"id\":\"%s\",\"state\":\"%s\",\"ret\":%ld,\"serverId\":\"%llu\",\"responsePeer\":\"%s\",\"responseClientId\":\"%s\",\"serialized\":%s}",j->id,j->response?(j->ret==0?"server-accepted":"server-rejected"):"unknown",j->ret,(unsigned long long)j->server_id,j->response_peer,j->response_client,j->serialized?"true":"false");reply(s,200,out);
done:HeapFree(GetProcessHeap(),0,data);
}
static DWORD WINAPI server(void *unused){(void)unused;WSADATA w;if(WSAStartup(MAKEWORD(2,2),&w))return 1;listener=socket(AF_INET,SOCK_STREAM,IPPROTO_TCP);if(listener==INVALID_SOCKET)return 2;BOOL exclusive=TRUE;setsockopt(listener,SOL_SOCKET,SO_EXCLUSIVEADDRUSE,(const char*)&exclusive,sizeof(exclusive));struct sockaddr_in address={0};address.sin_family=AF_INET;address.sin_addr.s_addr=htonl(INADDR_LOOPBACK);address.sin_port=htons((u_short)config.port);if(bind(listener,(struct sockaddr*)&address,sizeof(address))||listen(listener,2)){closesocket(listener);listener=INVALID_SOCKET;return 3;}while(running){SOCKET s=accept(listener,NULL,NULL);if(s==INVALID_SOCKET)break;DWORD timeout=10000;setsockopt(s,SOL_SOCKET,SO_RCVTIMEO,(const char*)&timeout,sizeof(timeout));serve(s);closesocket(s);}WSACleanup();return 0;}
__declspec(dllexport) DWORD WINAPI XiaoyuSocialStart(void *data){
    if(running||!data)return 1;StartConfig *c=data;if(c->magic!=0x32535958||c->bytes!=sizeof(*c)||c->pid!=GetCurrentProcessId()||c->port<1024||c->port>65535||c->limit<1||c->limit>512||strnlen(c->token,65)!=64||strnlen(c->account,129)>=129||strnlen(c->wxid,129)>=129||strnlen(c->pat_group,129)>=129||strnlen(c->pat_member,129)>=129)return 2;
    for(unsigned i=0;i<64;i++)if(!((c->token[i]>='0'&&c->token[i]<='9')||(c->token[i]>='a'&&c->token[i]<='f')))return 2;config=*c;if(!identifier(config.account,(unsigned)strlen(config.account))||!identifier(config.wxid,(unsigned)strlen(config.wxid))||!identifier(config.pat_group,(unsigned)strlen(config.pat_group))||!identifier(config.pat_member,(unsigned)strlen(config.pat_member))||!strcmp(config.pat_member,config.wxid)||strncmp(config.account,config.wxid,strlen(config.wxid))||config.account[strlen(config.wxid)]!='_'||!exact_build()||!account_verified()||!manager())return 3;
    HMODULE pinned;GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS|GET_MODULE_HANDLE_EX_FLAG_PIN,(LPCWSTR)XiaoyuSocialStart,&pinned);running=1;HANDLE thread=CreateThread(NULL,0,server,NULL,0,NULL);if(!thread){running=0;return 4;}CloseHandle(thread);return 0;
}
__declspec(dllexport) DWORD WINAPI XiaoyuSocialStop(void *unused){(void)unused;running=0;if(listener!=INVALID_SOCKET){shutdown(listener,SD_BOTH);closesocket(listener);listener=INVALID_SOCKET;}return 0;}
BOOL WINAPI DllMain(HINSTANCE module,DWORD reason,LPVOID unused){(void)unused;if(reason==DLL_PROCESS_ATTACH)DisableThreadLibraryCalls(module);return TRUE;}
