// Wire layout: magic, UUID, peer bytes, filename bytes, duration ms, size,
// SHA256, then peer + UUID.silk. Only files under the configured lease root.
typedef struct {uint32_t magic;char id[36];uint32_t peer_len,file_len,milliseconds,bytes;unsigned char sha256[32];} VoiceRequest;

__declspec(dllexport) int XiaoyuVoiceValidate(const void *buffer,unsigned size) {
    if(size<88)return 0;const VoiceRequest *r=buffer;
    if(r->magic!=0x31565958||!valid_uuid(r->id)||!r->peer_len||r->peer_len>128||r->file_len!=41||
       r->milliseconds<20||r->milliseconds>30000||r->milliseconds%20||r->bytes<13||r->bytes>1024*1024||size!=88+r->peer_len+r->file_len)return 0;
    const char *peer=(const char*)(r+1),*file=peer+r->peer_len;
    for(unsigned i=0;i<r->peer_len;i++)if(!((peer[i]>='a'&&peer[i]<='z')||(peer[i]>='A'&&peer[i]<='Z')||(peer[i]>='0'&&peer[i]<='9')||strchr("_@.-",peer[i])&&peer[i]))return 0;
    return valid_uuid(file)&&!memcmp(file,r->id,36)&&!memcmp(file+36,".silk",5);
}

static int voice_file(const VoiceRequest *r) {
    const char *peer=(const char*)(r+1),*relative=peer+r->peer_len;
    wchar_t filename[42],full[1024],resolved[1024];
    if(!MultiByteToWideChar(CP_UTF8,MB_ERR_INVALID_CHARS,relative,41,filename,42))return 0;filename[41]=0;
    if(swprintf(full,1024,L"%ls\\%ls",config.media_root,filename)<0)return 0;
    HANDLE file=CreateFileW(full,GENERIC_READ,FILE_SHARE_READ,NULL,OPEN_EXISTING,FILE_ATTRIBUTE_NORMAL,NULL);
    if(file==INVALID_HANDLE_VALUE)return 0;int accepted=0;LARGE_INTEGER length;unsigned char hash[32],*audio=NULL;
    DWORD chars=GetFinalPathNameByHandleW(file,resolved,1024,0);
    if(!chars||chars>=1024||_wcsnicmp(resolved,media_root,wcslen(media_root))||resolved[wcslen(media_root)]!=L'\\'||
       !GetFileSizeEx(file,&length)||length.QuadPart!=r->bytes||!hash_file(file,hash)||memcmp(hash,r->sha256,32))goto end;
    SetFilePointer(file,0,NULL,FILE_BEGIN);audio=HeapAlloc(GetProcessHeap(),0,r->bytes+1);if(!audio)goto end;DWORD got;
    if(!ReadFile(file,audio,r->bytes,&got,NULL)||got!=r->bytes||memcmp(audio,"\x02#!SILK_V3",10))goto end;audio[r->bytes]=0;
    unsigned at=10,packets=0;while(at<r->bytes){if(at+2>r->bytes)goto end;int size=(int16_t)(audio[at]|audio[at+1]<<8);at+=2;if(size<=0||size>1024||at+size>r->bytes)goto end;at+=size;packets++;}
    if(packets*20!=r->milliseconds)goto end;
#ifdef XY_OFFLINE_TEST
    test_calls++;accepted=1;
#else
    // Exact-build recording completion: 5f4ac00 -> 6e55690 -> 6e55af0.
    // Factory COPIES both borrowed strings using WeChat's own allocator. Never
    // construct a large owning MSVC string with a foreign allocation.
    unsigned char peer_string[32]={0},audio_string[32]={0},options[56]={0};
    if(r->peer_len<16)memcpy(peer_string,peer,r->peer_len);else *(const char**)peer_string=peer;
    *(uint64_t*)(peer_string+16)=r->peer_len;*(uint64_t*)(peer_string+24)=r->peer_len<16?15:r->peer_len;
    if(r->bytes<16)memcpy(audio_string,audio,r->bytes);else *(unsigned char**)audio_string=audio;*(uint64_t*)(audio_string+16)=r->bytes;*(uint64_t*)(audio_string+24)=r->bytes<16?15:r->bytes;
    *(uint64_t*)options=0x300000004ULL;*(uint64_t*)(options+8)=30000;*(uint64_t*)(options+48)=15;
    void *shared[2]={0};uint32_t duration=r->milliseconds;
    ((void(*)(void*,void*,void*,void*,void*))(core+XY_VOICE_FACTORY))(shared,peer_string,audio_string,&duration,options);
    if(!shared[0]||!shared[1]||shared[0]!=(char*)shared[1]+16||*(uintptr_t*)shared[0]!=(uintptr_t)(core+XY_VOICE_BODY)||*(uintptr_t*)shared[1]!=(uintptr_t)(core+XY_VOICE_OWNER))goto end;
    *(uint32_t*)((char*)shared[0]+0x118)=34;accepted=queue_native(shared);
#endif
    end:if(audio)HeapFree(GetProcessHeap(),0,audio);CloseHandle(file);return accepted;
}

static void voice_request(SOCKET socket) {
    char buffer[8193];int size=0,header_size=0;DWORD timeout=2000;setsockopt(socket,SOL_SOCKET,SO_RCVTIMEO,(char*)&timeout,4);
    while(size<8192){int got=recv(socket,buffer+size,8192-size,0);if(got<=0)return;size+=got;buffer[size]=0;char *end=strstr(buffer,"\r\n\r\n");if(end){header_size=(int)(end-buffer)+4;break;}}
    if(!header_size||header_size>4096||header_value(buffer,header_size,"Origin")||header_value(buffer,header_size,"Transfer-Encoding")){respond(socket,400,"{}");return;}
    char *auth=header_value(buffer,header_size,"Authorization");if(!auth||auth+73>buffer+header_size||strncmp(auth,"Bearer ",7)){respond(socket,401,"{}");return;}auth+=7;
    unsigned difference=0;for(int i=0;i<64;i++)difference|=(unsigned char)auth[i]^(unsigned char)config.token[i];if(difference||auth[64]!='\r'||auth[65]!='\n'){respond(socket,401,"{}");return;}
    if(!strncmp(buffer,"GET /health HTTP/1.1\r\n",22)){
        int valid=exact_build()&&account_verified();char body[600];
        snprintf(body,sizeof(body),"{\"integration\":\"XiaoyuVoice-1\",\"pid\":%lu,\"accountDirectory\":\"%s\",\"version\":\"4.2.0.13\",\"verified\":%s,\"limit\":%u,\"submissions\":%ld,\"offlineTest\":%s}",GetCurrentProcessId(),config.account,valid?"true":"false",config.max_submissions,submissions,
#ifdef XY_OFFLINE_TEST
          "true"
#else
          "false"
#endif
        );respond(socket,valid?200:409,body);return;
    }
    if(strncmp(buffer,"POST /voice HTTP/1.1\r\n",22)){respond(socket,404,"{}");return;}
    char *length=header_value(buffer,header_size,"Content-Length"),*after;long bytes=length?strtol(length,&after,10):0;
    if(!length||after>=buffer+header_size||strncmp(after,"\r\n",2)||bytes<130||bytes>257){respond(socket,400,"{}");return;}
    while(size<header_size+bytes){int got=recv(socket,buffer+size,8192-size,0);if(got<=0)return;size+=got;}
    VoiceRequest *r=(VoiceRequest*)(buffer+header_size);if(size!=header_size+bytes||!XiaoyuVoiceValidate(r,(unsigned)bytes)){respond(socket,400,"{}");return;}
    const char *peer=(const char*)(r+1);
    if(config.max_submissions==1&&(r->peer_len!=10||memcmp(peer,"filehelper",10))){respond(socket,403,"{}");return;}
    for(unsigned i=0;i<seen_count&&i<128;i++)if(!memcmp(seen[i],r->id,36)){respond(socket,409,"{\"state\":\"already-attempted\"}");return;}
    if(submissions>=(LONG)config.max_submissions||!exact_build()||!account_verified()){respond(socket,409,"{}");return;}
    memcpy(seen[seen_count++%128],r->id,36);InterlockedIncrement(&submissions);int accepted=0;
    __try{accepted=voice_file(r);}__except(EXCEPTION_EXECUTE_HANDLER){accepted=0;}
    respond(socket,accepted?200:500,accepted?"{\"state\":\"submitted\"}":"{\"state\":\"unknown\"}");
}
