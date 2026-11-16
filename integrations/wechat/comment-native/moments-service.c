// Independent exact-build own-Moments service. No automatic activation or replies.
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
typedef struct {uint32_t magic,bytes,pid,port;char token[65],account[129],wxid[129],signing_key[65];uint32_t max_reads,allow_comment;uint64_t max_comments;} StartConfig;
typedef struct {uint32_t magic;char id[36];uint32_t length;} Request;
typedef struct {void *object;uintptr_t pid,handle;ULONG access;USHORT trace,kind;ULONG attributes,reserved;} HandleEntry;
typedef LONG (WINAPI *QuerySystem)(ULONG,void*,ULONG,ULONG*);
static volatile LONG read_attempts,comment_attempts;static char used_ids[16384][37];static unsigned used_count;static uint64_t requested_object,budget_day;
static struct {uint64_t id,at;} own_objects[256];static unsigned own_cursor;
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
__declspec(dllexport) int XiaoyuMomentsServiceCompletionTest(void){
#ifdef XY_OFFLINE_TEST
unsigned char memory[0xa0]={0},copy[56]={0};void *old=task;task=memory;install_completion(memory);void *value=memory;int a=0,b=0;void *cb=*(void**)(memory+0x98);int ok=cb==memory+0x60&&((void*(*)(void*,void*))completion_table[0])(cb,copy)==copy&&*(uintptr_t**)copy==completion_table&&completion_call(cb,&value,&a,&b)==1;completion_delete(cb,0);task=old;InterlockedExchange(&completed,0);return ok;
#else
return 0;
#endif
}
static int readable(const void *p,size_t n){MEMORY_BASIC_INFORMATION m;uintptr_t a=(uintptr_t)p;return p&&n&&VirtualQuery(p,&m,sizeof(m))&&m.State==MEM_COMMIT&&!(m.Protect&(PAGE_NOACCESS|PAGE_GUARD))&&a>=(uintptr_t)m.BaseAddress&&n<=(uintptr_t)m.BaseAddress+m.RegionSize-a;}
static int hex64(const char *p){if(strnlen(p,65)!=64)return 0;for(unsigned i=0;i<64;i++)if(!((p[i]>='0'&&p[i]<='9')||(p[i]>='a'&&p[i]<='f')))return 0;return 1;}
__declspec(dllexport) int XiaoyuMomentsServiceValidate(const void *data,unsigned size){
 if(!data||size<sizeof(Request))return 0;const Request *r=data;if((r->magic!=0x344d5958&&r->magic!=0x334d5958&&r->magic!=0x354d5958)||!r->length||r->length>32000||size!=sizeof(*r)+r->length)return 0;
 for(unsigned i=0;i<36;i++){char c=r->id[i];if(i==8||i==13||i==18||i==23){if(c!='-')return 0;}else if(!((c>='0'&&c<='9')||(c>='a'&&c<='f')))return 0;}return 1;
}
static int content_signature(const void *data,unsigned size,char *out){BCRYPT_ALG_HANDLE alg=NULL;BCRYPT_HASH_HANDLE h=NULL;unsigned char hash[32],key[32];for(unsigned i=0;i<32;i++){unsigned v;char b[3]={config.signing_key[i*2],config.signing_key[i*2+1],0};if(sscanf(b,"%2x",&v)!=1)return 0;key[i]=(unsigned char)v;}
 if(BCryptOpenAlgorithmProvider(&alg,BCRYPT_SHA256_ALGORITHM,NULL,BCRYPT_ALG_HANDLE_HMAC_FLAG))return 0;NTSTATUS result=BCryptCreateHash(alg,&h,NULL,0,key,32,0);if(!result)result=BCryptHashData(h,(PUCHAR)data,size,0);if(!result)result=BCryptFinishHash(h,hash,32,0);if(h)BCryptDestroyHash(h);BCryptCloseAlgorithmProvider(alg,0);SecureZeroMemory(key,sizeof(key));if(result)return 0;for(unsigned i=0;i<32;i++)sprintf(out+i*2,"%02x",hash[i]);return 1;}
static int signed_content(const void *data,unsigned size,const char *signature){char expected[65];if(!signature||!hex64(signature)||!content_signature(data,size,expected))return 0;unsigned diff=0;for(unsigned i=0;i<64;i++)diff|=(unsigned char)expected[i]^(unsigned char)signature[i];return diff==0;}
static int variable(const unsigned char *s,unsigned n,unsigned *at,uint64_t *v){*v=0;for(unsigned i=0;i<10&&*at<n;i++){unsigned c=s[(*at)++];if(i==9&&c>1)return 0;*v|=(uint64_t)(c&127)<<(7*i);if(!(c&128))return 1;}return 0;}
static uint64_t now_seconds(void){FILETIME ft;GetSystemTimeAsFileTime(&ft);ULARGE_INTEGER t;t.LowPart=ft.dwLowDateTime;t.HighPart=ft.dwHighDateTime;return t.QuadPart/10000000ULL-11644473600ULL;}
static int field(const unsigned char *s,unsigned n,unsigned wanted,unsigned wanted_wire,const unsigned char **p,unsigned *length,uint64_t *value){unsigned at=0,found=0;while(at<n){uint64_t tag,v;if(!variable(s,n,&at,&tag)||!(tag>>3))return 0;unsigned key=(unsigned)(tag>>3),wire=tag&7;const unsigned char *bytes=NULL;unsigned size=0;if(wire==0){if(!variable(s,n,&at,&v))return 0;}else if(wire==2){if(!variable(s,n,&at,&v)||v>n-at)return 0;size=(unsigned)v;bytes=s+at;at+=size;}else if(wire==1||wire==5){unsigned k=wire==1?8:4;if(n-at<k)return 0;at+=k;v=0;}else return 0;if(key==wanted){if(wire!=wanted_wire||found++)return 0;if(p)*p=bytes;if(length)*length=size;if(value)*value=v;}}return found==1;}
static int var_field(const unsigned char *s,unsigned n,unsigned k,uint64_t *v){return field(s,n,k,0,NULL,NULL,v);}
static int byte_field(const unsigned char *s,unsigned n,unsigned k,const unsigned char **p,unsigned *size){return field(s,n,k,2,p,size,NULL);}
static int own_username(const unsigned char *s,unsigned n){return n==strlen(config.wxid)&&!memcmp(s,config.wxid,n);}
static void remember_own(uint64_t id,int owned){if(!id)return;for(unsigned i=0;i<256;i++)if(own_objects[i].id==id){own_objects[i].at=owned?now_seconds():0;return;}if(owned){unsigned i=own_cursor++%256;own_objects[i].id=id;own_objects[i].at=now_seconds();}}
static int fresh_own(uint64_t id){uint64_t now=now_seconds();for(unsigned i=0;i<256;i++)if(own_objects[i].id==id&&own_objects[i].at&&own_objects[i].at<=now&&now-own_objects[i].at<=300)return 1;return 0;}
static int own_object(const unsigned char *s,unsigned n,uint64_t *id){const unsigned char *user;unsigned len;uint64_t deleted=0;if(var_field(s,n,25,&deleted)&&deleted)return 0;return var_field(s,n,1,id)&&*id&&byte_field(s,n,2,&user,&len)&&own_username(user,len);}
static void cache_owned_response(const unsigned char *s,unsigned n,LONG ret){if(operation==3){const unsigned char *obj;unsigned len;uint64_t id;if(!ret&&byte_field(s,n,2,&obj,&len)&&own_object(obj,len,&id)&&id==requested_object)remember_own(id,1);else remember_own(requested_object,0);}
 if(operation==5&&!ret){unsigned at=0;while(at<n){uint64_t tag,v;if(!variable(s,n,&at,&tag))return;unsigned key=(unsigned)(tag>>3),wire=tag&7;if(wire==0){if(!variable(s,n,&at,&v))return;}else if(wire==2){if(!variable(s,n,&at,&v)||v>n-at)return;if(key==4){uint64_t id;if(own_object(s+at,(unsigned)v,&id))remember_own(id,1);}at+=(unsigned)v;}else if(wire==1||wire==5){unsigned k=wire==1?8:4;if(n-at<k)return;at+=k;}else return;}}}
static void reset_budget(void){uint64_t day=now_seconds()/86400;if(day!=budget_day){budget_day=day;read_attempts=comment_attempts=0;used_count=0;}}
// layer 0=response, 1=BaseResponse, 2=SnsObject; no unbounded recursive fields.
static int fields(const unsigned char *s,unsigned n,unsigned layer,LONG *ret,uint64_t *id,int *has_ret){unsigned at=0;while(at<n){uint64_t tag,v;if(!variable(s,n,&at,&tag)||!(tag>>3)||tag>>3>0x1fffffff)return 0;unsigned key=(unsigned)(tag>>3),wire=tag&7;if(wire==0){if(!variable(s,n,&at,&v))return 0;if(layer==1&&key==1){*ret=(LONG)(uint32_t)v;*has_ret=1;}if(layer==2&&key==1)*id=v;}else if(wire==2){if(!variable(s,n,&at,&v)||v>n-at)return 0;if(layer==0&&(key==1||(key==2&&operation==3))&&!fields(s+at,(unsigned)v,key==1?1:2,ret,id,has_ret))return 0;at+=(unsigned)v;}else if(wire==1||wire==5){unsigned k=wire==1?8:4;if(n-at<k)return 0;at+=k;}else return 0;}return 1;}
__declspec(dllexport) int XiaoyuMomentsServiceParse(const void *data,unsigned size,uint64_t *id,LONG *ret){if(!data||!size||size>524288||!id||!ret)return 0;int has=0;*id=0;*ret=0x7fffffff;return fields(data,size,0,ret,id,&has)&&has;}
static void *on_destroy(void *p,unsigned flags){void *result=((void*(*)(void*,unsigned))original[0])(p,flags);InterlockedExchange(&destroyed,1);return result;}
static unsigned char on_response(void *p,void *holder){
 // Keep the real task's result protobuf valid for the native manager.
 unsigned char ok=((unsigned char(*)(void*,void*))original[2])(p,holder);
 unsigned n=((unsigned(*)(void*))(core+XY_HOLDER_SIZE))(holder);void *data=((void*(*)(void*,int))(core+XY_HOLDER_DATA))(holder,0);LONG ret;uint64_t id;
 if(p==task&&n<=524288&&readable(data,n)&&XiaoyuMomentsServiceParse(data,n,&id,&ret)){memcpy(response_bytes,data,n);response_size=n;cache_owned_response(data,n,ret);return_code=ret;object_id=id;InterlockedExchange(&received,1);}return ok;
}
static void *manager(void){
#ifdef XY_OFFLINE_TEST
 return NULL; // The mock can test encoding/parsing, never submit or pretend delivery.
#else
 void **root=(void**)*(uintptr_t*)(core+XY_ROOT_GLOBAL);if(!readable(root,0x2d0)||root[0]!=core+XY_ROOT_VTABLE)return NULL;void **m=(void**)*(uintptr_t*)((char*)root+0x2c8);if(!readable(m,8)||m[0]!=core+XY_MANAGER_VTABLE)return NULL;void **table=m[0];if(!readable(table,48)||table[5]!=core+XY_MANAGER_DISPATCH)return NULL;return m;
#endif
}
static int detail_target(const Request *r,uint64_t *id){const unsigned char *s=(const unsigned char*)(r+1),*base;unsigned len;uint64_t zero;return byte_field(s,r->length,1,&base,&len)&&var_field(s,r->length,2,id)&&*id&&var_field(s,r->length,3,&zero)&&zero==0;}
static int own_page_target(const Request *r){const unsigned char *s=(const unsigned char*)(r+1),*user;unsigned len;uint64_t cursor,zero;return byte_field(s,r->length,3,&user,&len)&&own_username(user,len)&&var_field(s,r->length,4,&cursor)&&var_field(s,r->length,5,&zero)&&zero==0&&var_field(s,r->length,6,&zero)&&zero==0;}
static int reply_target(const Request *r){const unsigned char *s=(const unsigned char*)(r+1),*group,*action,*from,*content;unsigned gn,an,fn,cn;uint64_t id,type,created;if(!byte_field(s,r->length,2,&group,&gn)||!var_field(group,gn,1,&id)||!fresh_own(id)||!byte_field(group,gn,3,&action,&an)||!byte_field(action,an,1,&from,&fn)||!own_username(from,fn)||!var_field(action,an,5,&type)||type!=2||!var_field(action,an,7,&created)||!byte_field(action,an,8,&content,&cn)||!cn||cn>512)return 0;uint64_t now=now_seconds();return created<=now+300&&created+900>=now;}
__declspec(dllexport) int XiaoyuMomentsServiceAuthorize(const void *data,unsigned length,const char *signature){const Request *r=data;uint64_t id;if(!XiaoyuMomentsServiceValidate(r,length))return 0;if(r->magic==0x334d5958)return detail_target(r,&id);if(r->magic==0x354d5958)return own_page_target(r);return config.allow_comment==2&&signed_content(data,length,signature)&&reply_target(r);}
static int admit(const Request *r){reset_budget();for(unsigned i=0;i<used_count;i++)if(!memcmp(used_ids[i],r->id,36))return 0;if(used_count>=16384||(r->magic!=0x344d5958&&read_attempts>=(LONG)config.max_reads)||(r->magic==0x344d5958&&comment_attempts>=(LONG)config.max_comments))return 0;memcpy(used_ids[used_count++],r->id,36);if(r->magic==0x344d5958)InterlockedIncrement(&comment_attempts);else InterlockedIncrement(&read_attempts);return 1;}
__declspec(dllexport) int XiaoyuMomentsServiceMockConfigure(unsigned reads,unsigned comments){
#ifdef XY_OFFLINE_TEST
 if(!reads||reads>10000||!comments||comments>500)return 0;memset(&config,0,sizeof(config));strcpy(config.wxid,"wxid_test");memset(config.signing_key,'a',64);config.signing_key[64]=0;config.allow_comment=2;config.max_reads=reads;config.max_comments=comments;budget_day=0;reset_budget();memset(own_objects,0,sizeof(own_objects));remember_own(123,1);return 1;
#else
 (void)reads;(void)comments;return 0;
#endif
}
__declspec(dllexport) int XiaoyuMomentsServiceMockAdmit(const void *data,unsigned length){
#ifdef XY_OFFLINE_TEST
 return XiaoyuMomentsServiceValidate(data,length)&&admit(data);
#else
 (void)data;(void)length;return 0;
#endif
}
static int submit(const Request *r){
#ifdef XY_OFFLINE_TEST
 (void)r;return 0;
#else
 if(!exact_build()||!account_verified())return 0;void *m=manager();if(!m)return 0;
 // Use the client allocator and actual SNS constructor/destructor, not a fake AppMsg task.
 operation=r->magic==0x334d5958?3:r->magic==0x354d5958?5:4;int detail=operation==3,page=operation==5;requested_object=0;if(detail)detail_target(r,&requested_object);void *memory=((void*(*)(size_t))(core+XY_ALLOCATE))(page?0x1c0:0xf0);if(!memory)return 0;unsigned char info[64]={0};memcpy(info,core+(page?XY_PAGE_INFO:detail?XY_DETAIL_INFO:XY_COMMENT_INFO),16);
 char endpoint[64];strcpy(endpoint,page?"/cgi-bin/micromsg-bin/mmsnsuserpage":detail?"/cgi-bin/micromsg-bin/mmsnsobjectdetail":"/cgi-bin/micromsg-bin/mmsnscomment");*(uint32_t*)(info+16)=page?212:detail?210:213;*(void**)(info+24)=endpoint;*(uint64_t*)(info+40)=strlen(endpoint);*(uint64_t*)(info+48)=63;info[56]=1;
 ((void(*)(void*,void*))(core+(page?XY_PAGE_CTOR:detail?XY_DETAIL_CTOR:XY_COMMENT_CTOR)))(memory,info);uintptr_t *table=*(uintptr_t**)memory;
 uintptr_t expected[5];if(page){expected[0]=0x3154700;expected[1]=0x3154610;expected[2]=0x10a6de0;expected[3]=0x115010;expected[4]=0x10a6e20;}else if(detail){expected[0]=0x3163900;expected[1]=0x7b3d80;expected[2]=0x7b3e70;expected[3]=0x115010;expected[4]=0x7b3eb0;}else{expected[0]=0x315a5f0;expected[1]=0x10acb00;expected[2]=0x7b3e70;expected[3]=0x115010;expected[4]=0x7b3eb0;}
 if(table!=(uintptr_t*)(core+(page?XY_PAGE_VTABLE:detail?XY_DETAIL_VTABLE:XY_COMMENT_VTABLE))||table[5]!=1)return 0;for(unsigned i=0;i<5;i++)if(table[i]!=(uintptr_t)(core+expected[i]))return 0;memcpy(original,table,sizeof(original));
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
 char headers[8193];memcpy(headers,data,head);headers[head]=0;int auth=0,origin=0,cl=0,invalid=0,sig_count=0;char signature[65]={0};char expected[80];snprintf(expected,sizeof(expected),"Bearer %s",config.token);char *line=strstr(headers,"\r\n");while(line&&line[2]!='\r'){line+=2;char *end=strstr(line,"\r\n");if(!end)break;*end=0;if(!_strnicmp(line,"Authorization:",14)){char *v=line+14;while(*v==' ')v++;if(auth||strcmp(v,expected))invalid=1;auth++;}if(!_strnicmp(line,"X-Content-Signature:",20)){char *v=line+20;while(*v==' ')v++;if(sig_count++||!hex64(v))invalid=1;else memcpy(signature,v,65);}if(!_strnicmp(line,"Origin:",7))origin=1;if(!_strnicmp(line,"Transfer-Encoding:",18))invalid=1;if(!_strnicmp(line,"Content-Length:",15)){char *v=line+15,*last;while(*v==' ')v++;unsigned long parsed=strtoul(v,&last,10);if(cl++||last==v||*last||parsed>32044)invalid=1;length=(unsigned)parsed;}*end='\r';line=end;}
 if(auth!=1||origin||invalid){reply(s,403,"{\"error\":\"denied\"}");return;}
 char out[1000];if(!strncmp(data,"GET /health HTTP/1.1\r\n",22)){if(!admitted||(completed&&destroyed&&received))reset_budget();snprintf(out,sizeof(out),"{\"integration\":\"XiaoyuMomentsService-1\",\"pid\":%lu,\"accountDirectory\":\"%s\",\"offlineTest\":%s,\"verified\":%s,\"limit\":1,\"attempts\":%ld,\"readAttempts\":%ld,\"maxReads\":%u,\"maxComments\":%llu,\"commentAttempts\":%ld,\"allowComment\":%s,\"scope\":\"own-moments\",\"textValidated\":false,\"images\":false,\"video\":false}",GetCurrentProcessId(),config.account,offline_flag,exact_build()&&account_verified()&&manager()?"true":"false",admitted,read_attempts,config.max_reads,(unsigned long long)config.max_comments,comment_attempts,config.allow_comment==2?"true":"false");reply(s,200,out);return;}
 if(!strncmp(data,"GET /object HTTP/1.1\r\n",22)){if((operation!=3&&operation!=5)||!received||!completed||!destroyed||return_code||!response_size){reply(s,409,"{\"error\":\"object-not-available\"}");return;}char *body=HeapAlloc(GetProcessHeap(),0,response_size*2+128);if(!body)return;sprintf(body,"{\"id\":\"%s\",\"protobufHex\":\"",request_id);unsigned off=(unsigned)strlen(body);for(unsigned i=0;i<response_size;i++)sprintf(body+off+i*2,"%02x",response_bytes[i]);strcat(body,"\"}");reply(s,200,body);HeapFree(GetProcessHeap(),0,body);return;}
 if(!strncmp(data,"GET /result HTTP/1.1\r\n",22)){result_json(out,sizeof(out));reply(s,200,out);return;}
 if(strncmp(data,"POST /submit HTTP/1.1\r\n",23)){reply(s,404,"{\"error\":\"route\"}");return;}
 if(cl!=1||length<44||length>32044||head+length>=sizeof(data)){reply(s,400,"{\"error\":\"size\"}");return;}while(n<head+length){int k=recv(s,data+n,head+length-n,0);if(k<=0)return;n+=k;}
 const Request *r=(const Request*)(data+head);if(!XiaoyuMomentsServiceAuthorize(r,length,signature)){reply(s,403,"{\"error\":\"unapproved-content\"}");return;}
 if(admitted&&(!completed||!destroyed||!received)){reply(s,409,"{\"error\":\"previous-result-unknown-no-new-task\"}");return;}
 if(!admit(r)){reply(s,409,"{\"error\":\"request-replayed-or-daily-budget-exhausted\"}");return;}
 admitted=1;received=destroyed=submitted=completed=0;response_size=0;object_id=0;return_code=0x7fffffff;memcpy(request_id,r->id,36);request_id[36]=0;submit(r);
 DWORD until=GetTickCount()+8000;while(submitted&&(!received||!completed||!destroyed)&&(LONG)(until-GetTickCount())>0)Sleep(20);result_json(out,sizeof(out));reply(s,200,out);
}
static DWORD WINAPI server(void *unused){(void)unused;WSADATA w;if(WSAStartup(MAKEWORD(2,2),&w))return 1;listener=socket(AF_INET,SOCK_STREAM,IPPROTO_TCP);BOOL exclusive=TRUE;setsockopt(listener,SOL_SOCKET,SO_EXCLUSIVEADDRUSE,(const char*)&exclusive,sizeof(exclusive));struct sockaddr_in address={0};address.sin_family=AF_INET;address.sin_addr.s_addr=htonl(INADDR_LOOPBACK);address.sin_port=htons((u_short)config.port);if(bind(listener,(struct sockaddr*)&address,sizeof(address))||listen(listener,2)){closesocket(listener);listener=INVALID_SOCKET;return 2;}while(running){SOCKET s=accept(listener,NULL,NULL);if(s==INVALID_SOCKET)break;DWORD timeout=10000;setsockopt(s,SOL_SOCKET,SO_RCVTIMEO,(const char*)&timeout,sizeof(timeout));serve(s);closesocket(s);}WSACleanup();return 0;}
__declspec(dllexport) DWORD WINAPI XiaoyuMomentsServiceStart(void *data){if(running||!data)return 1;StartConfig *c=data;if(c->magic!=0x384d5958||c->bytes!=sizeof(*c)||c->pid!=GetCurrentProcessId()||c->port<1024||c->port>65535||!hex64(c->token)||!hex64(c->signing_key)||c->max_reads<1||c->max_reads>10000||(c->allow_comment!=0&&c->allow_comment!=2)||!c->max_comments||c->max_comments>500||strnlen(c->account,129)>=129||strnlen(c->wxid,129)>=129)return 2;config=*c;unsigned len=(unsigned)strlen(config.wxid);if(len<6||strncmp(config.wxid,"wxid_",5)||strncmp(config.account,config.wxid,len)||config.account[len]!='_'||!exact_build()||!account_verified()||!manager())return 3;HMODULE pin;GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS|GET_MODULE_HANDLE_EX_FLAG_PIN,(LPCWSTR)XiaoyuMomentsServiceStart,&pin);running=1;HANDLE thread=CreateThread(NULL,0,server,NULL,0,NULL);if(!thread){running=0;return 4;}CloseHandle(thread);return 0;}
__declspec(dllexport) DWORD WINAPI XiaoyuMomentsServiceStop(void *unused){(void)unused;running=0;if(listener!=INVALID_SOCKET){shutdown(listener,SD_BOTH);closesocket(listener);listener=INVALID_SOCKET;}return 0;}
BOOL WINAPI DllMain(HINSTANCE module,DWORD reason,LPVOID unused){(void)unused;if(reason==DLL_PROCESS_ATTACH)DisableThreadLibraryCalls(module);return TRUE;}
