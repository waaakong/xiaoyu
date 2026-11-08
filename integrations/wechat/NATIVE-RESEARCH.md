# Current-version native adaptation

**Update, 0.22.0:** The initial findings below are a historical research record.
An independent text DLL has now been built, loaded and checked against actual
server-ID receipts on the exact current core. Operational details, remaining
scope boundaries and final hashes are in [native/README.md](native/README.md).
The runtime selects this adapter explicitly; the legacy `nativeProfile` guard
continues to reject unknown versions and does not relabel the old Hook.

The initial stage was an offline research path, separate from the foreground sender.
No current-version DLL, loader, native profile or installer is supplied here.
`nativeProfile('4.2.0.13')` intentionally remains `null`.

## Reproduce static comparison

Use Python with `pefile==2024.8.26` and `capstone==5.0.9` available. A local
library directory can be supplied explicitly, including with embedded Python:

```powershell
python scripts/wechat-native-analyze.py `
  --analysis-libs data/wechat-analysis-libs `
  --old-core '<reference 4.1.10.27>/Weixin.dll' `
  --current-core '<current 4.2.0.13>/Weixin.dll' `
  --source-header '<reviewed reference>/include/global.h' `
  --output data/wechat-native-research/4.2.0.13-static.json
```

The program opens PE files as data. It neither loads a DLL nor opens a live
process, connects to a service or sends a message. Its JSON is research evidence,
not a configuration consumed by the runtime. `loadable` is always false.
Input fingerprints are included. Recheck Authenticode and exact file versions
separately; a SHA-256 fingerprint alone does not authenticate a file.

The analyzer reads x64 exception-table ranges directly to avoid creating
hundreds of thousands of unwind objects. It searches 64/128/256/512/1024-byte
instruction windows, masking branch addresses and RIP-relative displacements
while retaining structure offsets and other immediates. It checks source-image
ambiguity as well as new-image ambiguity. Weak matches include an instruction
similarity ranking; a high score is not a compatibility decision.

MSVC RTTI complete-object-locator self references and bounded type identities
provide additional table/function correlations. These identities may be
obfuscated. They corroborate a candidate, without proving ownership, argument
layout, calling thread, initialization or behavior.

## Local findings, 2026-11-06

Examined current core SHA-256:
`afe3d02c58bada3c35009c0cd58ee1f57b2a00fe53237d0dce649107fddb9a20`.
The current executable and core both reported 4.2.0.13 and valid Tencent
Authenticode signatures during the separate local audit.

The 4.1.10.27 reference core SHA-256 was
`f487e4f56930456a25fb0d7b058c77e2dcd364e268d49bdfff4dc0e3be26ba36`.
Offsets below are RVAs for those exact files only:

| Dependency | Static finding in 4.2.0.13 | Validation |
| --- | --- | --- |
| Parameter constructor | `0xf910`, unique masked signature | ABI unverified |
| Send wrapper | `0x1a20280`, one RTTI-correlated candidate among four similar wrappers | ABI unverified |
| Text constructor | `0x790db0`, one RTTI-correlated candidate among five short-window matches | ABI unverified |
| First parameter vtable | `0x93f9a48`, unique RTTI candidate | Layout unverified |
| Text-message vtable | `0x912f3b8`, unique RTTI candidate | Layout unverified |
| Three secondary parameter vtables | Unresolved | Not usable |
| Secondary global parameter object | Unresolved | Not usable |
| Account identity / incoming event / independent receipt | Not ported to native adapter | Not usable |

The reviewed local upstream manifest pins commit
`e905d07ade50d2c6472e4eb3bd4f3fe19cf662c6`. Of 129 entries, 128 matched;
`include/json/README.md` differed. The code/header files used by this analysis
matched, but the complete source tree must not be described as fully verified.
No compilation was attempted from that tree.

[WeChatGirl README](https://github.com/my12yyds/WeChatGirl/blob/main/README.md)
and [Hook README](https://github.com/aixed/WeChat-Hook/blob/main/README.md),
checked on the same date, still document 4.1.10.27. The Hook repository metadata
has no detected license and the local source lacks a top-level license. These
facts do not establish permission to redistribute its code or binary. This tool
copies neither. Original binaries and generated research reports stay in local
ignored data directories.

## Remaining work before a loading proposal

1. Resolve secondary parameter dependencies, message layout, object ownership
   and safe execution thread using independent binary/call-graph evidence.
2. Port explicit account verification and native event reception. Preserve
   authorized target checks and independent server-message-ID receipts. A
   native function returning success is only submission, not delivery.
3. Establish an available x64 C++ toolchain and appropriate source authorization
   for any code actually reused. Common MSBuild/VS, clang and g++ locations were
   not found locally in this audit; no toolchain was installed.
4. Build a minimal component offline and exercise its protocol against a fake
   backend: mismatched version/account/target, concurrent sends, cancellation,
   unknown submission, no automatic resend, and no automatic foreground/native
   switch. These new-component tests have not happened because there is no new
   component yet.
5. Present exact component hashes, target process/build, loading, stopping and
   recovery steps for separate user approval before any live loading. After
   approval, validate actual receipt and measure receive/generation/delivery
   separately against QQ. No QQ-parity claim before actual measurements.

The existing foreground transport remains usable. Static findings are not a
reason to relax the runtime version guard or declare native adaptation complete.
