# REG-076 — Windows migration checksum line-ending portability

## Reproduction

A cumulative owner run on Windows 10 against accepted `main` `cad56551daac9d9d634eb83c92781a60308a97d4` passed environment validation and applied migrations `0001` through `0018`, then failed inside `test:m1-06-final`.

The exact accepted LF checksum for `0012_secure_file_upload_quarantine` is:

`98507fbb39bfeba540a2a06b71e727f28123d35489a89b562dce8396e790af1b`

The same accepted SQL checked out by Git for Windows with CRLF line endings hashes to:

`cdf728a36e2b9ecd83978eeefeed64edd3fb6532ff1a179033c7244cf27a060a`

The migration engine previously hashed raw checkout bytes, so migration identity depended on operating-system line endings even though the SQL semantics and Git content were identical.

## Root cause

`listMigrations()` read UTF-8 SQL and hashed it without canonicalizing line endings. Linux CI used LF while the owner Windows checkout used CRLF. The pinned checksum test therefore failed on Windows, and a Windows-created migration ledger could not be safely compared with a Linux checkout.

## Root fix

- Canonicalize migration SQL line endings to LF before execution and checksum calculation.
- Derive the exact CRLF-equivalent checksum from the canonical SQL and accept it only as a bounded line-ending normalization state.
- Normalize an accepted CRLF ledger checksum once to the canonical checksum without rewriting the original migration release metadata.
- Preserve exact historical checksum-repair allowlists for migrations `0012` and `0013`.
- Preserve fail-closed behavior for every unknown/tampered checksum.
- Add the exact Windows reproduction checksum and normalization behavior to the permanent M1.06 regression suite and source guard.

## Security property

This does not accept arbitrary checksum drift. Only the checksum derived from the exact current canonical SQL with CRLF line endings is treated as equivalent. Any content change beyond line endings remains a mismatch and blocks migration execution.
