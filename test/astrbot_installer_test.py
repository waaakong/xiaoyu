"""Offline regressions against the installed, pinned AstrBot interpreter."""
import asyncio
import pathlib
import sys
import tempfile
import unittest
import zipfile

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / 'integrations' / 'astrbot'))
from xiaoyu_installer import run_child, install_installer_adapter


class InstallerTests(unittest.IsolatedAsyncioTestCase):
    async def test_repeated_pip_failure_then_recovery_and_unchanged_core(self):
        from astrbot.core.utils.pip_installer import PipInstaller, PipInstallError
        install_installer_adapter()
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            wheel = root / 'xiaoyu_install_fixture-1.0-py3-none-any.whl'
            with zipfile.ZipFile(wheel, 'w') as archive:
                archive.writestr('xiaoyu_install_fixture.py', 'value=1\n')
                prefix = 'xiaoyu_install_fixture-1.0.dist-info/'
                archive.writestr(prefix+'METADATA', 'Metadata-Version: 2.1\nName: xiaoyu-install-fixture\nVersion: 1.0\n')
                archive.writestr(prefix+'WHEEL', 'Wheel-Version: 1.0\nGenerator: xiaoyu-test\nRoot-Is-Purelib: true\nTag: py3-none-any\n')
                archive.writestr(prefix+'RECORD', '')
            installer = PipInstaller('--no-index --no-deps --disable-pip-version-check')
            original_stdout = sys.stdout
            for index in range(3):
                # Only a temporary target; no real dependency is installed/updated.
                await installer._run_pip_with_classification(['install', '--no-index', '--no-deps', '--target', str(root / str(index)), str(wheel)])
                self.assertTrue((root / str(index) / 'xiaoyu_install_fixture.py').exists())
            with self.assertRaises(PipInstallError):
                await installer._run_pip_with_classification(['install', '--no-index', '--no-deps', 'xiaoyu-absent-fixture-zz==0.0'])
            await installer._run_pip_with_classification(['install', '--no-index', '--no-deps', '--target', str(root / 'recovered'), str(wheel)])
            self.assertIs(sys.stdout, original_stdout)
            self.assertTrue((root / 'recovered' / 'xiaoyu_install_fixture.py').exists())

    async def test_timeout_and_cancel_release_child(self):
        with self.assertRaises(TimeoutError):
            await run_child([sys.executable, '-c', 'import time;time.sleep(60)'], timeout=0.2)
        task = asyncio.create_task(run_child([sys.executable, '-c', 'import time;time.sleep(60)']))
        await asyncio.sleep(0.2)
        task.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await task
        code, lines = await run_child([sys.executable, '-c', 'print("recovered")'])
        self.assertEqual(code, 0)
        self.assertIn('recovered', lines)


if __name__ == '__main__':
    unittest.main()
