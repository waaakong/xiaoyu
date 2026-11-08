"""Offline safety/candidate tests. Run with analysis dependencies on sys.path."""
import importlib.util
from pathlib import Path
import unittest
import struct
from types import SimpleNamespace
from capstone import Cs, CS_ARCH_X86, CS_MODE_64

spec = importlib.util.spec_from_file_location('native_analysis', Path(__file__).resolve().parents[1] / 'scripts/wechat-native-analyze.py')
analysis = importlib.util.module_from_spec(spec)
spec.loader.exec_module(analysis)


class AnalysisTests(unittest.TestCase):
    def setUp(self):
        self.decoder = Cs(CS_ARCH_X86, CS_MODE_64)
        self.decoder.detail = True

    def test_relocation_is_masked_but_structure_displacement_is_not(self):
        # call rel32; mov rax,[rip+disp32]; mov [rcx+0x70],rax
        code = bytes.fromhex('e811223344488b057766554448894170')
        decoded, mask = analysis.signature(code, 0x1000, self.decoder)
        self.assertEqual(decoded, code)
        self.assertEqual(mask.hex(), 'ff00000000ffffff00000000ffffffff')

    def test_short_branch_is_masked(self):
        _, mask = analysis.signature(bytes.fromhex('75029090c3'), 0x1000, self.decoder)
        self.assertEqual(mask, bytes.fromhex('ff00ffffff'))

    def test_unrelated_immediate_is_preserved(self):
        _, mask = analysis.signature(bytes.fromhex('48c7c101000000'), 0x1000, self.decoder)
        self.assertEqual(mask, b'\xff' * 7)

    def test_scan_preserves_ambiguity_and_overlaps(self):
        code = b'A' * 24
        self.assertEqual(analysis.scan(b'A' * 26, code, b'\xff' * 24), [0, 1, 2])

    def test_wildcards_include_newlines(self):
        self.assertEqual(analysis.scan(b'A' * 24 + b'\n', b'A' * 24 + b'X', b'\xff' * 24 + b'\0'), [0])

    def test_weak_or_malformed_signatures_rejected(self):
        self.assertEqual(analysis.scan(b'A' * 50, b'A' * 24, b'\0' * 24), [])
        self.assertEqual(analysis.scan(b'A' * 50, b'A' * 24, b'\xff'), [])

    def test_unique_match_still_not_abi_validated(self):
        code = bytes.fromhex('48894c2408') + b'\x90' * 59

        class FakeImage:
            functions = {0x100: 0x140}
            executable = [(0x100, code)]

            def read(self, rva, size):
                return code[:size]

        result = analysis.compare_function(FakeImage(), FakeImage(), 0x100, self.decoder)
        self.assertEqual(result['status'], 'unique-static-candidate')
        self.assertFalse(result['abiValidated'])

    def test_ambiguous_old_function_cannot_become_unique_candidate(self):
        code = b'\x90' * 64

        class Old:
            functions = {0x100: 0x140, 0x140: 0x180}
            executable = [(0x100, code * 2)]

            def read(self, rva, size):
                return code[:size]

        class New(Old):
            functions = {0x100: 0x140}
            executable = [(0x100, code)]

        result = analysis.compare_function(Old(), New(), 0x100, self.decoder)
        self.assertEqual(result['status'], 'unresolved')

    def test_rtti_requires_consistent_complete_object_locator(self):
        image = analysis.Image.__new__(analysis.Image)
        image.pe = SimpleNamespace(OPTIONAL_HEADER=SimpleNamespace(ImageBase=0x180000000))
        memory = {0xf8: struct.pack('<Q', 0x180000200),
                  0x200: struct.pack('<6I', 1, 0, 0, 0x300, 0x400, 0x200),
                  0x310: b'.?AVunique_research_type@@\0' + b'\0' * 480}
        image.read = lambda address, size: memory[address][:size]
        self.assertEqual(image.rtti_identity(0x100), b'.?AVunique_research_type@@')
        memory[0x200] = struct.pack('<6I', 1, 0, 0, 0x300, 0x400, 0x201)
        self.assertIsNone(image.rtti_identity(0x100))

    def test_rtti_rejects_unmapped_data(self):
        image = analysis.Image.__new__(analysis.Image)
        image.pe = SimpleNamespace(OPTIONAL_HEADER=SimpleNamespace(ImageBase=0x180000000))

        def invalid(address, size):
            raise ValueError('Unmapped')

        image.read = invalid
        self.assertIsNone(image.rtti_identity(0x100))


if __name__ == '__main__':
    unittest.main()
