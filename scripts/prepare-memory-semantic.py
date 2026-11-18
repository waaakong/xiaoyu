"""Prepare a private CPU embedding environment and pinned, hash-verified model."""
import argparse, hashlib, json, pathlib, subprocess, sys, urllib.request, venv

REVISION = 'e8f8c211226b894fcb81acc59f3b34ba3efd5f42'
FILES = {
    'onnx/model_quint8_avx2.onnx': '98a01d88b7de996cdea58c32ca71208c09968d143798814b2ea09d3439dc334f',
    'tokenizer.json': '2c3387be76557bd40970cec13153b3bbf80407865484b209e655e5e4729076b8',
}

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--base', required=True)
    parser.add_argument('--mirror', choices=['official', 'hf-mirror'], default='official')
    args = parser.parse_args()
    base = pathlib.Path(args.base).resolve() / 'memory-semantic'
    base.mkdir(parents=True, exist_ok=True)
    env = base / 'env'
    python = env / ('Scripts/python.exe' if sys.platform == 'win32' else 'bin/python')
    if not python.exists():
        venv.create(env, with_pip=True)
    # Pin CPU-only wheels. This worker uses Tokenizer.from_file, not Hub/PyTorch.
    # Avoid resolving optional training/Hub dependencies in the speech environment.
    wheels = base / 'wheels'
    wheels.mkdir(exist_ok=True)
    downloaded = []
    for name, version in [('onnxruntime', '1.23.2'), ('tokenizers', '0.22.2'), ('numpy', '1.26.4')]:
        metadata = json.load(urllib.request.urlopen(f'https://pypi.org/pypi/{name}/{version}/json', timeout=20))
        tag = f'cp{sys.version_info.major}{sys.version_info.minor}'
        choices = [f for f in metadata['urls'] if f['filename'].endswith('.whl') and 'win_amd64' in f['filename'] and (tag in f['filename'] or name == 'tokenizers' and 'cp39-abi3' in f['filename'])]
        if len(choices) != 1:
            raise ValueError('No unique Windows CPU wheel for this Python version')
        wheel = choices[0]
        destination = wheels / wheel['filename']
        expected = wheel['digests']['sha256']
        if not destination.exists() or hashlib.sha256(destination.read_bytes()).hexdigest() != expected:
            print(json.dumps({'phase': 'wheel', 'package': name}), flush=True)
            with urllib.request.urlopen(wheel['url'], timeout=60) as response, destination.open('wb') as out:
                while chunk := response.read(1024 * 1024):
                    out.write(chunk)
            if hashlib.sha256(destination.read_bytes()).hexdigest() != expected:
                raise ValueError('Wheel SHA256 mismatch')
        downloaded.append(str(destination))
    subprocess.run([str(python), '-m', 'pip', 'install', '--no-index', '--no-deps', '--disable-pip-version-check', *downloaded], check=True)
    subprocess.run([str(python), '-I', '-c', 'import numpy, onnxruntime; from tokenizers import Tokenizer'], check=True)
    host = 'huggingface.co' if args.mirror == 'official' else 'hf-mirror.com'
    model = base / 'model'
    for remote, expected in FILES.items():
        destination = model / remote
        destination.parent.mkdir(parents=True, exist_ok=True)
        if destination.exists() and hashlib.sha256(destination.read_bytes()).hexdigest() == expected:
            continue
        temporary = destination.with_suffix(destination.suffix + '.part')
        url = f'https://{host}/sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2/resolve/{REVISION}/{remote}?download=true'
        print(json.dumps({'phase': 'download', 'file': remote}), flush=True)
        digest = hashlib.sha256()
        with urllib.request.urlopen(url, timeout=60) as response, temporary.open('wb') as out:
            size = 0
            while chunk := response.read(1024 * 1024):
                size += len(chunk)
                if size > 130_000_000:
                    raise ValueError('model file exceeds limit')
                digest.update(chunk)
                out.write(chunk)
        if digest.hexdigest() != expected:
            raise ValueError('model SHA256 mismatch')
        temporary.replace(destination)
    manifest = {'model': 'paraphrase-multilingual-MiniLM-L12-v2-int8', 'revision': REVISION, 'dimension': 384, 'files': FILES, 'source': 'sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2', 'license': 'Apache-2.0'}
    (base / 'manifest.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
    print(json.dumps({'phase': 'ready', 'dimension': 384}), flush=True)

if __name__ == '__main__':
    main()
