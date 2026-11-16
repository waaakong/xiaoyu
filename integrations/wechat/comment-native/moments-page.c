// Independent exact-build finite comment/detail review component. No auto activation.
// No patches to client code, no UI fallback, no credential export, no automatic activation.
#define WIN32_LEAN_AND_MEAN
#include <winsock2.h>
#include <windows.h>
#include <bcrypt.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <wchar.h>
#include "profile.h"
typedef struct {uint32_t magic,bytes,pid,port;char token[65],account[129],wxid[129],approved_hash[65];uint32_t max_reads,allow_comment;uint64_t allowed_object;} StartConfig;
typedef struct {uint32_t magic;char id[36];uint32_t length;} Request;
typedef struct {void *object;uintptr_t pid,handle;ULONG access;USHORT trace,kind;ULONG attributes,reserved;} HandleEntry;
typedef LONG (WINAPI *QuerySystem)(ULONG,void*,ULONG,ULONG*);
static volatile LONG read_attempts,comment_attempts;static char used_ids[16][37];static unsigned used_count;
static StartConfig config;static unsigned char *core;static volatile LONG running,admitted,received,destroyed;static SOCKET listener=INVALID_SOCKET;
#ifdef XY_OFFLINE_TEST
static int test_verified=1;
static const char *offline_flag="true";
#else
static const char *offline_flag="false";
#endif
#include "../social-native/identity.h"
static void *task;static uintptr_t original[6],owned_table[6];static char request_id[37];static uint64_t object_id;static LONG return_code=0x7fffffff;static volatile LONG submitted,completed;static unsigned operation,response_size;static unsigned char response_bytes[524288];
// TaskManager unconditionally invokes its MSVC std::function at task+0x98.
// Its call arguments are references to task*, transport error and CGI error.
// Returning true transfers task destruction back to the real manager.
static uintptr_t completion_table[6];
static void *completion_copy(void *self,void *where){(void)self;*(uintptr_t**)where=completion_table;return where;}
static unsigned char completion_call(void *self,void **value,int *transport,int *cgi){(void)self;(void)transport;(void)cgi;if(!value||*value!=task)return 0;InterlockedExchange(&completed,1);return 1;}
static void *completion_type(void *self){(void)self;return NULL;}
static void completion_delete(void *self,unsigned char deallocate){(void)self;(void)deallocate;/* inline object is owned/freed by the native task */}
static void install_completion(void *memory){completion_table[0]=(uintptr_t)completion_copy;completion_table[1]=(uintptr_t)completion_copy;completion_table[2]=(uintptr_t)completion_call;completion_table[3]=(uintptr_t)completion_type;completion_table[4]=(uintptr_t)completion_delete;completion_table[5]=(uintptr_t)completion_type;*(uintptr_t**)((char*)memory+0x60)=completion_table;*(void**)((char*)memory+0x98)=(char*)memory+0x60;}
__declspec(dllexport) int XiaoyuMomentPageCompletionTest(void){
#ifdef XY_OFFLINE_TEST
unsigned char memory[0xa0]={0},copy[56]={0};void *old=task;task=memory;install_completion(memory);void *value=memory;int a=0,b=0;void *cb=*(void**)(memory+0x98);int ok=cb==memory+0x60&&((void*(*)(void*,void*))completion_table[0])(cb,copy)==copy&&*(uintptr_t**)copy==completion_table&&completion_call(cb,&value,&a,&b)==1;completion_delete(cb,0);task=old;InterlockedExchange(&completed,0);return ok;
#else
return 0;
#endif
}
static int readable(const void *p,size_t n){MEMORY_BASIC_INFORMATION m;uintptr_t a=(uintptr_t)p;return p&&n&&VirtualQuery(p,&m,sizeof(m))&&m.State==MEM_COMMIT&&!(m.Protect&(PAGE_NOACCESS|PAGE_GUARD))&&a>=(uintptr_t)m.BaseAddress&&n<=(uintptr_t)m.BaseAddress+m.RegionSize-a;}
static int hex64(const char *p){if(strnlen(p,65)!=64)return 0;for(unsigned i=0;i<64;i++)if(!((p[i]>='0'&&p[i]<='9')||(p[i]>='a'&&p[i]<='f')))return 0;return 1;}
__declspec(dllexport) int XiaoyuMomentPageValidate(const void *data,unsigned size){
 if(!data||size<sizeof(Request))return 0;const Request *r=data;if(r->magic!=0x354d5958||!r->length||r->length>32000||size!=sizeof(*r)+r->length)return 0;
 for(unsigned i=0;i<36;i++){char c=r->id[i];if(i==8||i==13||i==18||i==23){if(c!='-')return 0;}else if(!((c>='0'&&c<='9')||(c>='a'&&c<='f')))return 0;}return 1;
}
static int hash_matches(const void *data,unsigned size){BCRYPT_ALG_HANDLE alg=NULL;BCRYPT_HASH_HANDLE h=NULL;unsigned char hash[32];char hex[65];if(BCryptOpenAlgorithmProvider(&alg,BCRYPT_SHA256_ALGORITHM,NULL,0))return 0;NTSTATUS result=BCryptCreateHash(alg,&h,NULL,0,NULL,0,0);if(!result)result=BCryptHashData(h,(PUCHAR)data,size,0);if(!result)result=BCryptFinishHash(h,hash,32,0);if(h)BCryptDestroyHash(h);BCryptCloseAlgorithmProvider(alg,0);if(result)return 0;for(unsigned i=0;i<32;i++)sprintf(hex+i*2,"%02x",hash[i]);return !memcmp(hex,config.approved_hash,65);}
static int variable(const unsigned char *s,unsigned n,unsigned *at,uint64_t *v){*v=0;for(unsigned i=0;i<10&&*at<n;i++){unsigned c=s[(*at)++];if(i==9&&c>1)return 0;*v|=(uint64_t)(c&127)<<(7*i);if(!(c&128))return 1;}return 0;}
// layer 0=response, 1=BaseResponse, 2=SnsObject; no unbounded recursive fields.
static int fields(const unsigned char *s,unsigned n,unsigned layer,LONG *ret,uint64_t *id,int *has_ret){unsigned at=0;while(at<n){uint64_t tag,v;if(!variable(s,n,&at,&tag)||!(tag>>3)||tag>>3>0x1fffffff)return 0;unsigned key=(unsigned)(tag>>3),wire=tag&7;if(wire==0){if(!variable(s,n,&at,&v))return 0;if(layer==1&&key==1){*ret=(LONG)(uint32_t)v;*has_ret=1;}if(layer==2&&key==1)*id=v;}else if(wire==2){if(!variable(s,n,&at,&v)||v>n-at)return 0;if(layer==0&&key==1&&!fields(s+at,(unsigned)v,key==1?1:2,ret,id,has_ret))return 0;at+=(unsigned)v;}else if(wire==1||wire==5){unsigned k=wire==1?8:4;if(n-at<k)return 0;at+=k;}else return 0;}return 1;}
__declspec(dllexport) int XiaoyuMomentPageParse(const void *data,unsigned size,uint64_t *id,LONG *ret){if(!data||!size||size>524288||!id||!ret)return 0;int has=0;*id=0;*ret=0x7fffffff;return fields(data,size,0,ret,id,&has)&&has;}
static void *on_destroy(void *p,unsigned flags){void *result=((void*(*)(void*,unsigned))original[0])(p,flags);InterlockedExchange(&destroyed,1);return result;}
static unsigned char on_response(void *p,void *holder){
 // Keep the real task's result protobuf valid for the native manager.
 unsigned char ok=((unsigned char(*)(void*,void*))original[2])(p,holder);
 unsigned n=((unsigned(*)(void*))(core+XY_HOLDER_SIZE))(holder);void *data=((void*(*)(void*,int))(core+XY_HOLDER_DATA))(holder,0);LONG ret;uint64_t id;
 if(p==task&&n<=524288&&readable(data,n)&&XiaoyuMomentPageParse(data,n,&id,&ret)){memcpy(response_bytes,data,n);response_size=n;return_code=ret;object_id=id;InterlockedExchange(&received,1);}return ok;
}
static void *manager(void){
#ifdef XY_OFFLINE_TEST
 return NULL; // The mock can test encoding/parsing, never submit or pretend delivery.
#else
 void **root=(void**)*(uintptr_t*)(core+XY_ROOT_GLOBAL);if(!readable(root,0x2d0)||root[0]!=core+XY_ROOT_VTABLE)return NULL;void **m=(void**)*(uintptr_t*)((char*)root+0x2c8);if(!readable(m,8)||m[0]!=core+XY_MANAGER_VTABLE)return NULL;void **table=m[0];if(!readable(table,48)||table[5]!=core+XY_MANAGER_DISPATCH)return NULL;return m;
#endif
}
// Read-only requests must bind the single reviewed object and exact detail schema.
static int own_page_target(const Request *r){const unsigned char *p=(const unsigned char*)(r+1);unsigned at=0;uint64_t tag,len,value;
 if(!variable(p,r->length,&at,&tag)||tag!=10||!variable(p,r->length,&at,&len)||len>r->length-at)return 0;at+=(unsigned)len;
 if(!variable(p,r->length,&at,&tag)||tag!=18||!variable(p,r->length,&at,&len)||len)return 0;
 if(!variable(p,r->length,&at,&tag)||tag!=26||!variable(p,r->length,&at,&len)||len!=strlen(config.wxid)||len>r->length-at||memcmp(p+at,config.wxid,(size_t)len))return 0;at+=(unsigned)len;
 for(unsigned field=4;field<=6;field++){if(!variable(p,r->length,&at,&tag)||tag!=field*8||!variable(p,r->length,&at,&value)||value)return 0;}return at==r->length;}
__declspec(dllexport) int XiaoyuMomentPageAuthorize(const void *data,unsigned length){const Request *r=data;return XiaoyuMomentPageValidate(r,length)&&own_page_target(r);}
__declspec(dllexport) int XiaoyuMomentPagePolicyTest(void){
#ifdef XY_OFFLINE_TEST
 StartConfig previous=config;strcpy(config.wxid,"wxid_test");unsigned char data[96]={0};Request *r=(Request*)data;r->magic=0x354d5958;memcpy(r->id,"12345678-1234-1234-1234-123456789abc",36);unsigned char body[]={10,0,18,0,26,9,'w','x','i','d','_','t','e','s','t',32,0,40,0,48,0};r->length=sizeof(body);memcpy(r+1,body,sizeof(body));int bits=0;
 if(XiaoyuMomentPageAuthorize(r,44+r->length))bits|=1;((unsigned char*)(r+1))[6]='o';if(!XiaoyuMomentPageAuthorize(r,44+r->length))bits|=2;((unsigned char*)(r+1))[6]='w';((unsigned char*)(r+1))[16]=1;if(!XiaoyuMomentPageAuthorize(r,44+r->length))bits|=4;((unsigned char*)(r+1))[16]=0;r->magic=0x344d5958;if(!XiaoyuMomentPageAuthorize(r,44+r->length))bits|=8;config=previous;return bits;
#else
 return 0;
#endif
}
static int submit(const Request *r){
#ifdef XY_OFFLINE_TEST
 (void)r;return 0;
#else
 if(!exact_build()||!account_verified())return 0;void *m=manager();if(!m)return 0;
 // Use the client allocator and actual SNS constructor/destructor, not a fake AppMsg task.
 operation=5;void *memory=((void*(*)(size_t))(core+XY_ALLOCATE))(0x1c0);if(!memory)return 0;unsigned char info[64]={0};memcpy(info,core+XY_PAGE_INFO,16);
 char endpoint[64];strcpy(endpoint,"/cgi-bin/micromsg-bin/mmsnsuserpage");*(uint32_t*)(info+16)=212;*(void**)(info+24)=endpoint;*(uint64_t*)(info+40)=strlen(endpoint);*(uint64_t*)(info+48)=63;info[56]=1;
 ((void(*)(void*,void*))(core+XY_PAGE_CTOR))(memory,info);uintptr_t *table=*(uintptr_t**)memory;
 uintptr_t expected[5]={0x3154700,0x3154610,0x10a6de0,0x115010,0x10a6e20};
 if(table!=(uintptr_t*)(core+XY_PAGE_VTABLE)||table[5]!=1)return 0;for(unsigned i=0;i<5;i++)if(table[i]!=(uintptr_t)(core+expected[i]))return 0;memcpy(original,table,sizeof(original));
 // Native ParseFromArray -> native serializer -> native account/device preparation.
 if(!((unsigned char(*)(void*,const void*,int))(core+XY_PROTO_PARSE))((char*)memory+0xa8,r+1,r->length)){((void*(*)(void*,unsigned))original[0])(memory,1);return 0;}
 memcpy(owned_table,original,sizeof(original));owned_table[0]=(uintptr_t)on_destroy;owned_table[2]=(uintptr_t)on_response;task=memory;*(uintptr_t**)memory=owned_table;install_completion(memory);
 InterlockedExchange(&submitted,1);((void(*)(void*,void*))(core+XY_MANAGER_DISPATCH))(m,memory);return 1;
#endif
}
static void result_json(char *out,unsigned cap){snprintf(out,cap,"{\"id\":\"%s\",\"state\":\"%s\",\"ret\":%ld,\"objectId\":\"%llu\",\"submitted\":%s,\"taskCompleted\":%s,\"taskDestroyed\":%s}",request_id,received&&completed&&destroyed?(return_code==0?"server-accepted":"server-rejected"):(submitted?"unknown":(admitted?"not-submitted":"idle")),return_code,(unsigned long long)object_id,submitted?"true":"false",completed?"true":"false",destroyed?"true":"false");}
static int send_all(SOCKET s,const char *p,int n){while(n){int k=send(s,p,n,0);if(k<=0)return 0;p+=k;n-=k;}return 1;}
static void reply(SOCKET s,int code,const char *body){char head[256];int n=snprintf(head,sizeof(head),"HTTP/1.1 %d Result\r\nContent-Type: application/json\r\nCache-Control: no-store\r\nConnection: close\r\nContent-Length: %u\r\n\r\n",code,(unsigned)strlen(body));if(send_all(s,head,n))send_all(s,body,(int)strlen(body));}
static void serve(SOCKET s){char data[40000];unsigned n=0,head=0,length=0;while(n<8192){int k=recv(s,data+n,8192-n,0);if(k<=0)return;n+=k;data[n]=0;char *end=strstr(data,"\r\n\r\n");if(end){head=(unsigned)(end-data)+4;break;}}if(!head)return;
 char headers[8193];memcpy(headers,data,head);headers[head]=0;int auth=0,origin=0,cl=0,invalid=0;char expected[80];snprintf(expected,sizeof(expected),"Bearer %s",config.token);char *line=strstr(headers,"\r\n");while(line&&line[2]!='\r'){line+=2;char *end=strstr(line,"\r\n");if(!end)break;*end=0;if(!_strnicmp(line,"Authorization:",14)){char *v=line+14;while(*v==' ')v++;if(auth||strcmp(v,expected))invalid=1;auth++;}if(!_strnicmp(line,"Origin:",7))origin=1;if(!_strnicmp(line,"Transfer-Encoding:",18))invalid=1;if(!_strnicmp(line,"Content-Length:",15)){char *v=line+15,*last;while(*v==' ')v++;unsigned long parsed=strtoul(v,&last,10);if(cl++||last==v||*last||parsed>32044)invalid=1;length=(unsigned)parsed;}*end='\r';line=end;}
 if(auth!=1||origin||invalid){reply(s,403,"{\"error\":\"denied\"}");return;}
 char out[1000];if(!strncmp(data,"GET /health HTTP/1.1\r\n",22)){snprintf(out,sizeof(out),"{\"integration\":\"XiaoyuMomentPage-1\",\"pid\":%lu,\"accountDirectory\":\"%s\",\"offlineTest\":%s,\"verified\":%s,\"limit\":1,\"attempts\":%ld,\"readAttempts\":%ld,\"maxReads\":%u,\"commentAttempts\":%ld,\"allowComment\":%s,\"scope\":\"own-first-page\",\"textValidated\":false,\"images\":false,\"video\":false}",GetCurrentProcessId(),config.account,offline_flag,exact_build()&&account_verified()&&manager()?"true":"false",admitted,read_attempts,config.max_reads,comment_attempts,config.allow_comment?"true":"false");reply(s,200,out);return;}
 if(!strncmp(data,"GET /object HTTP/1.1\r\n",22)){if(operation!=5||!received||!completed||!destroyed||return_code||!response_size){reply(s,409,"{\"error\":\"object-not-available\"}");return;}char *body=HeapAlloc(GetProcessHeap(),0,response_size*2+32);if(!body)return;strcpy(body,"{\"protobufHex\":\"");unsigned off=(unsigned)strlen(body);for(unsigned i=0;i<response_size;i++)sprintf(body+off+i*2,"%02x",response_bytes[i]);strcat(body,"\"}");reply(s,200,body);HeapFree(GetProcessHeap(),0,body);return;}
 if(!strncmp(data,"GET /result HTTP/1.1\r\n",22)){result_json(out,sizeof(out));reply(s,200,out);return;}
 if(strncmp(data,"POST /submit HTTP/1.1\r\n",23)){reply(s,404,"{\"error\":\"route\"}");return;}
 if(cl!=1||length<44||length>32044||head+length>=sizeof(data)){reply(s,400,"{\"error\":\"size\"}");return;}while(n<head+length){int k=recv(s,data+n,head+length-n,0);if(k<=0)return;n+=k;}
 const Request *r=(const Request*)(data+head);if(!XiaoyuMomentPageAuthorize(r,length)){reply(s,403,"{\"error\":\"unapproved-content\"}");return;}
 if(admitted&&(!completed||!destroyed||!received)){reply(s,409,"{\"error\":\"previous-result-unknown-no-new-task\"}");return;}
 for(unsigned i=0;i<used_count;i++)if(!memcmp(used_ids[i],r->id,36)){reply(s,409,"{\"error\":\"request-id-already-used\"}");return;}
 if(used_count>=16||(r->magic==0x354d5958&&read_attempts>=(LONG)config.max_reads)||(r->magic==0x344d5958&&comment_attempts)){reply(s,409,"{\"error\":\"review-budget-exhausted\"}");return;}
 memcpy(used_ids[used_count++],r->id,36);if(r->magic==0x334d5958)InterlockedIncrement(&read_attempts);else InterlockedIncrement(&comment_attempts);
 admitted=1;received=destroyed=submitted=completed=0;response_size=0;object_id=0;return_code=0x7fffffff;memcpy(request_id,r->id,36);request_id[36]=0;submit(r);
 DWORD until=GetTickCount()+8000;while(submitted&&(!received||!completed||!destroyed)&&(LONG)(until-GetTickCount())>0)Sleep(20);result_json(out,sizeof(out));reply(s,200,out);
}
static DWORD WINAPI server(void *unused){(void)unused;WSADATA w;if(WSAStartup(MAKEWORD(2,2),&w))return 1;listener=socket(AF_INET,SOCK_STREAM,IPPROTO_TCP);BOOL exclusive=TRUE;setsockopt(listener,SOL_SOCKET,SO_EXCLUSIVEADDRUSE,(const char*)&exclusive,sizeof(exclusive));struct sockaddr_in address={0};address.sin_family=AF_INET;address.sin_addr.s_addr=htonl(INADDR_LOOPBACK);address.sin_port=htons((u_short)config.port);if(bind(listener,(struct sockaddr*)&address,sizeof(address))||listen(listener,2)){closesocket(listener);listener=INVALID_SOCKET;return 2;}while(running){SOCKET s=accept(listener,NULL,NULL);if(s==INVALID_SOCKET)break;DWORD timeout=10000;setsockopt(s,SOL_SOCKET,SO_RCVTIMEO,(const char*)&timeout,sizeof(timeout));serve(s);closesocket(s);}WSACleanup();return 0;}
__declspec(dllexport) DWORD WINAPI XiaoyuMomentPageStart(void *data){if(running||!data)return 1;StartConfig *c=data;if(c->magic!=0x374d5958||c->bytes!=sizeof(*c)||c->pid!=GetCurrentProcessId()||c->port<1024||c->port>65535||!hex64(c->token)||!hex64(c->approved_hash)||c->max_reads<1||c->max_reads>1||c->allow_comment!=0||!c->allowed_object||strnlen(c->account,129)>=129||strnlen(c->wxid,129)>=129)return 2;config=*c;unsigned len=(unsigned)strlen(config.wxid);if(len<6||strncmp(config.wxid,"wxid_",5)||strncmp(config.account,config.wxid,len)||config.account[len]!='_'||!exact_build()||!account_verified()||!manager())return 3;HMODULE pin;GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS|GET_MODULE_HANDLE_EX_FLAG_PIN,(LPCWSTR)XiaoyuMomentPageStart,&pin);running=1;HANDLE thread=CreateThread(NULL,0,server,NULL,0,NULL);if(!thread){running=0;return 4;}CloseHandle(thread);return 0;}
__declspec(dllexport) DWORD WINAPI XiaoyuMomentPageStop(void *unused){(void)unused;running=0;if(listener!=INVALID_SOCKET){shutdown(listener,SD_BOTH);closesocket(listener);listener=INVALID_SOCKET;}return 0;}
BOOL WINAPI DllMain(HINSTANCE module,DWORD reason,LPVOID unused){(void)unused;if(reason==DLL_PROCESS_ATTACH)DisableThreadLibraryCalls(module);return TRUE;}
