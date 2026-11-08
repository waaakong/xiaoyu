import pathlib,sys,zipfile,stat
archive=pathlib.Path(sys.argv[1]);target=pathlib.Path(sys.argv[2]).resolve()
if not target.is_dir():raise RuntimeError('Extraction target does not exist')
with zipfile.ZipFile(archive) as z:
    items=z.infolist()
    if len(items)>30000 or sum(i.file_size for i in items)>3_500_000_000:raise RuntimeError('Component archive is oversized')
    for i in items:
        name=i.filename.replace('\\','/')
        p=(target/name).resolve()
        if ':' in name or name.startswith('/') or not p.is_relative_to(target) or stat.S_ISLNK(i.external_attr>>16):raise RuntimeError('Unsafe archive member')
    for i in items:z.extract(i,target)
print('Official component archive extracted; no software started.')
