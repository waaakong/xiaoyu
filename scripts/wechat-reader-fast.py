"""Run the verified reader with bounded in-memory KDF reuse, never message caching.

The upstream deployment stays unchanged. Every operation still opens fresh,
query-only SQLCipher connections and executes the original authorization logic.
"""
import collections
import hashlib
import importlib.util
import os
from pathlib import Path
import sys
import threading
import time


def cached_deriver(derive, now=time.monotonic):
    values = collections.OrderedDict()
    lock = threading.Lock()

    def call(filename, fallback_key, fallback_salt, passphrase=''):
        if not passphrase:
            return derive(filename, fallback_key, fallback_salt, passphrase)
        try:
            bytes.fromhex(passphrase)
        except ValueError:
            return derive(filename, fallback_key, fallback_salt, passphrase)
        try:
            path = Path(filename).resolve(strict=True)
            info = path.stat()
            with path.open('rb') as stream:
                salt = stream.read(16)
            if len(salt) != 16:
                return derive(filename, fallback_key, fallback_salt, passphrase)
            credential = hashlib.sha256((passphrase+'\0'+fallback_key+'\0'+fallback_salt).encode()).digest()
            key = (str(path), info.st_dev, info.st_ino, salt, credential)
        except OSError:
            return derive(filename, fallback_key, fallback_salt, passphrase)
        with lock:
            previous = values.get(key)
            if previous and now()-previous[0] < 300:
                values.move_to_end(key)
                return previous[1]
            result = derive(filename, fallback_key, fallback_salt, passphrase)
            # Do not cache fallback/short-header/error results. A changed header
            # while deriving invalidates the result for reuse, too.
            try:
                with path.open('rb') as stream:
                    unchanged = stream.read(16) == salt
                same_file = path.stat().st_ino == info.st_ino
            except OSError:
                unchanged = same_file = False
            if unchanged and same_file and result[1] == salt.hex():
                values[key] = (now(), result)
                values.move_to_end(key)
                while len(values) > 32:
                    values.popitem(last=False)
            return result
    return call


class AdaptiveStop:
    def __init__(self, original, reader):
        self.original, self.reader = original, reader

    def __getattr__(self, name):
        return getattr(self.original, name)

    def wait(self, timeout=None):
        # Only the upstream poll's one-second wait changes. Back off when idle,
        # many chats are enabled, or any query failed; never busy-loop.
        if timeout == 1:
            try:
                if self.reader.clients and not self.reader.last_error and 0 < len(self.reader.selected_talkers()) <= 4:
                    timeout = .25
            except Exception:
                pass
        return self.original.wait(timeout)


def main():
    root = Path(sys.argv[1]).resolve(strict=True)
    source = root / 'scripts' / 'reader-api.py'
    spec = importlib.util.spec_from_file_location('xiaoyu_verified_reader', source)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module.nt.derive_database_key = cached_deriver(module.nt.derive_database_key)
    inputs_spec = importlib.util.spec_from_file_location('xiaoyu_reader_inputs', Path(__file__).with_name('wechat-reader-inputs.py'))
    inputs = importlib.util.module_from_spec(inputs_spec)
    inputs_spec.loader.exec_module(inputs)
    bind_inputs = inputs.install(module, root)
    reader = module.Reader()
    bind_inputs(reader)
    reader.stop = AdaptiveStop(reader.stop, reader)
    config = module.read_json(root / 'config' / 'wechatagent.json')
    token = module.read_json(root / 'state' / 'wechat-io-config.json')['reader_token']
    module.serve(reader, config['ports']['weflow'], token)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print('Fast reader startup failed: '+type(error).__name__, file=sys.stderr)
        sys.exit(1)
