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
