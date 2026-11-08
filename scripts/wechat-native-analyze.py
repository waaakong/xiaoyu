"""Offline PE comparison. Reads files only; never loads DLLs or opens processes.

Requires pefile and capstone on PYTHONPATH. A match is research evidence only,
not an ABI validation or an installable native profile.
"""
import argparse
from difflib import SequenceMatcher
import hashlib
import json
from pathlib import Path
import re
import struct
import sys


def signature(code, address, decoder):
    """Mask relocatable x64 branch operands and RIP-relative displacements."""
    from capstone import CS_GRP_CALL, CS_GRP_JUMP
    from capstone.x86_const import X86_OP_MEM, X86_REG_RIP
    result = bytearray()
    mask = bytearray()
    for ins in decoder.disasm(code, address):
        start = len(result)
        result.extend(ins.bytes)
        mask.extend(b'\xff' * ins.size)
        if ins.group(CS_GRP_CALL) or ins.group(CS_GRP_JUMP):
            if ins.imm_size:
                mask[start + ins.imm_offset:start + ins.imm_offset + ins.imm_size] = b'\0' * ins.imm_size
        if any(op.type == X86_OP_MEM and op.mem.base == X86_REG_RIP for op in ins.operands):
            mask[start + ins.disp_offset:start + ins.disp_offset + ins.disp_size] = b'\0' * ins.disp_size
    return bytes(result), bytes(mask)


def scan(data, code, mask, limit=101):
    if len(code) != len(mask) or sum(bool(x) for x in mask) < 24:
        return []
    # Anchor on the longest fixed run; avoid regex lookahead at every byte of
    # a 200 MB DLL, while preserving overlapping matches and all mask semantics.
    runs = list(re.finditer(b'[^\x00]+', mask))
    anchor = max(runs, key=lambda item: item.end() - item.start())
    anchor_bytes = code[anchor.start():anchor.end()]
    fixed = [(i, value) for i, (value, keep) in enumerate(zip(code, mask)) if keep]
    found = []
    position = 0
    while True:
        hit = data.find(anchor_bytes, position)
        if hit < 0:
            break
        position = hit + 1
        start = hit - anchor.start()
        if start >= 0 and start + len(code) <= len(data) and all(data[start + i] == value for i, value in fixed):
            found.append(start)
            if len(found) >= limit:
                break
    return found


class Image:
    def __init__(self, path):
        import pefile
        self.path = Path(path)
        self.data = self.path.read_bytes()
        self.pe = pefile.PE(data=self.data, fast_load=True)
        if self.pe.FILE_HEADER.Machine != 0x8664:
            raise ValueError('Only x64 PE images are supported')
        # Only need RUNTIME_FUNCTION ranges. Parsing every unwind object in
        # pefile consumes gigabytes for Weixin.dll; read fixed PE table records.
        directory = self.pe.OPTIONAL_HEADER.DATA_DIRECTORY[3]
        table = self.read(directory.VirtualAddress, directory.Size) if directory.Size else b''
        if len(table) % 12:
            raise ValueError('Malformed x64 exception directory')
        self.functions = {begin: end for begin, end, _ in struct.iter_unpack('<III', table)
                          if begin < end <= self.pe.OPTIONAL_HEADER.SizeOfImage}
        self.executable = [(s.VirtualAddress, s.get_data()) for s in self.pe.sections
                           if s.Characteristics & 0x20000000]

    def read(self, rva, size):
        section = self.pe.get_section_by_rva(rva)
        if section is None or rva + size > section.VirtualAddress + section.SizeOfRawData:
            raise ValueError(f'RVA {rva:#x} is not file-backed')
        offset = self.pe.get_offset_from_rva(rva)
        return self.data[offset:offset + size]

    def summary(self):
        return {'name': self.path.name, 'sha256': hashlib.sha256(self.data).hexdigest(),
                'machine': '8664', 'imageSize': self.pe.OPTIONAL_HEADER.SizeOfImage,
                'runtimeFunctions': len(self.functions)}

    def rtti_identity(self, vtable):
        """MSVC x64 COL with self-RVA consistency; names may be obfuscated."""
        try:
            base = self.pe.OPTIONAL_HEADER.ImageBase
            col = struct.unpack('<Q', self.read(vtable - 8, 8))[0] - base
            sig, _, _, descriptor, _, self_rva = struct.unpack('<6I', self.read(col, 24))
            if sig != 1 or self_rva != col:
                return None
            name = self.read(descriptor + 16, 512).split(b'\0', 1)[0]
            return name if 16 <= len(name) < 512 else None
        except (ValueError, struct.error):
            return None


def all_offsets(data, needle):
    position = 0
    while True:
        offset = data.find(needle, position)
        if offset < 0:
            return
        yield offset
        position = offset + 1


def relocate_vtable(old, new, rva):
    identity = old.rtti_identity(rva)
    hits = set()
    if identity:
        for offset in all_offsets(new.data, identity + b'\0'):
            descriptor = new.pe.get_rva_from_offset(offset) - 16
            for ref in all_offsets(new.data, struct.pack('<I', descriptor)):
                if ref < 12:
                    continue
                col = new.pe.get_rva_from_offset(ref - 12)
                try:
                    values = struct.unpack('<6I', new.read(col, 24))
                    if values[0] != 1 or values[5] != col:
                        continue
                    pointer = struct.pack('<Q', new.pe.OPTIONAL_HEADER.ImageBase + col)
                    for table_ref in all_offsets(new.data, pointer):
                        table = new.pe.get_rva_from_offset(table_ref) + 8
                        if new.rtti_identity(table) == identity:
                            hits.add(table)
                except (ValueError, struct.error):
                    continue
    return {'oldRva': hex(rva), 'status': 'unique-rtti-candidate' if len(hits) == 1 else 'unresolved',
            'candidates': [hex(x) for x in sorted(hits)], 'abiValidated': False,
            'identitySha256': hashlib.sha256(identity).hexdigest() if identity else None}


def compare_function(old, new, rva, decoder):
    end = old.functions.get(rva)
    if end is None:
        return {'oldRva': hex(rva), 'status': 'not-a-known-function-entry',
                'candidates': [], 'rankedWeakMatches': [], 'abiValidated': False}
    searches = []
    for length in (64, 128, 256, 512, 1024):
        size = min(end - rva, length)
        code, mask = signature(old.read(rva, size), rva, decoder)
        # Include old-image self matches as an ambiguity control.
        old_hits, new_hits = [], []
        for image, hits in ((old, old_hits), (new, new_hits)):
            for start, section in image.executable:
                hits.extend(start + off for off in scan(section, code, mask)
                            if start + off in image.functions)
        searches.append({'window': length, 'decodedBytes': len(code),
                         'fixedBytes': sum(bool(x) for x in mask),
                         'oldMatches': [hex(x) for x in old_hits],
                         'newMatches': [hex(x) for x in new_hits]})
    best = next((item for item in reversed(searches)
                 if item['oldMatches'] == [hex(rva)] and len(item['newMatches']) == 1), None)
    # Weak matches remain explicit candidates, never promoted by a fuzzy score.
    def normalized(image, address):
        size = min(image.functions[address] - address, 4096)
        return [signature(ins.bytes, ins.address, decoder)
                for ins in decoder.disasm(image.read(address, size), address)]
    original = normalized(old, rva)
    ranked = []
    for address in sorted({int(hit, 16) for item in searches for hit in item['newMatches']}):
        compared = normalized(new, address)
        ranked.append({'rva': hex(address), 'bytes': new.functions[address] - address,
                       'normalizedInstructionSimilarity': round(SequenceMatcher(None, original, compared, autojunk=False).ratio(), 4)})
    ranked.sort(key=lambda item: item['normalizedInstructionSimilarity'], reverse=True)
    return {'oldRva': hex(rva), 'oldFunctionBytes': end - rva, 'searches': searches,
            'status': 'unique-static-candidate' if best else 'unresolved',
            'candidates': best['newMatches'] if best else [], 'rankedWeakMatches': ranked,
            'abiValidated': False}


def analyze(old_path, new_path, header_path):
    from capstone import Cs, CS_ARCH_X86, CS_MODE_64
    old, new = Image(old_path), Image(new_path)
    decoder = Cs(CS_ARCH_X86, CS_MODE_64)
    decoder.detail = True
    header = Path(header_path).read_text(encoding='utf-8-sig')
    namespace = header.split('namespace offset', 1)[1].split('}', 1)[0]
    offsets = dict((name, int(value, 16)) for name, value in
                   re.findall(r'constexpr\s+\w+\s+(\w+)\s*=\s*(0x[0-9a-fA-F]+)', namespace))
    functions = {name: compare_function(old, new, offsets[name], decoder)
                 for name in ('create_param2', 'send_message', 'txt_message_ctr')}
    data = {name: relocate_vtable(old, new, offsets[name])
            for name in ('param1_vtable', 'param2_1', 'param2_2', 'param2_3', 'txt_message_vtbl')}
    data['param2'] = {'oldRva': hex(offsets['param2']), 'status': 'unresolved', 'abiValidated': False}
    # Preserve RIP-referenced table identities as independent corroboration.
    from capstone.x86_const import X86_OP_MEM, X86_REG_RIP
    for function in functions.values():
        references = {}
        for candidate in [function['oldRva']] + [item['rva'] for item in function['rankedWeakMatches']]:
            image = old if candidate == function['oldRva'] else new
            address = int(candidate, 16)
            references[candidate] = []
            for ins in decoder.disasm(image.read(address, image.functions[address] - address), address):
                for operand in ins.operands:
                    if operand.type == X86_OP_MEM and operand.mem.base == X86_REG_RIP:
                        target = ins.address + ins.size + operand.mem.disp
                        identity = image.rtti_identity(target)
                        if identity:
                            references[candidate].append({'instructionOffset': hex(ins.address - address),
                                'tableRva': hex(target), 'identitySha256': hashlib.sha256(identity).hexdigest()})
        function['rttiReferences'] = references
        original = [(item['instructionOffset'], item['identitySha256'])
                    for item in references[function['oldRva']]]
        correlated = [address for address, refs in references.items()
                      if address != function['oldRva'] and original and original == [
                          (item['instructionOffset'], item['identitySha256']) for item in refs]]
        if function['status'] == 'unresolved' and len(correlated) == 1:
            function['status'] = 'rtti-correlated-static-candidate'
            function['candidates'] = correlated
    return {'schema': 1, 'purpose': 'offline-research-only', 'loadable': False,
            'old': old.summary(), 'current': new.summary(),
            'sourceHeaderSha256': hashlib.sha256(Path(header_path).read_bytes()).hexdigest(),
            'functions': functions, 'dataDependencies': data,
            'blockers': ['Message layout, ownership and execution thread are not validated',
                         'Account identity and receive callback are not ported',
                         'No current-version native component has been built or loaded']}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--old-core', required=True)
    parser.add_argument('--current-core', required=True)
    parser.add_argument('--source-header', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--analysis-libs', help='Optional local pefile/capstone library directory')
    args = parser.parse_args()
    inputs = [Path(p).resolve() for p in (args.old_core, args.current_core, args.source_header)]
    output = Path(args.output).resolve()
    if output in inputs or output.suffix.lower() != '.json':
        parser.error('Output must be a separate JSON file')
    if args.analysis_libs:
        libs = Path(args.analysis_libs).resolve()
        if not libs.is_dir():
            parser.error('Analysis library directory does not exist')
        sys.path.insert(0, str(libs))
    report = analyze(*inputs)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'output': str(output), 'loadable': False,
                      'functions': {k: v['status'] for k, v in report['functions'].items()}}))


if __name__ == '__main__':
    main()
