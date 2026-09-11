# M1.06 Subunit 1 — Secure File Domain, Metadata Schema and Private Object Storage Adapter

## Status

**DONE — ENGINEERING PASS — 9 August 2026**

This subunit establishes the secure-file metadata and private object-storage authority required by M1.06. It deliberately does not implement upload intake, content-signature/MIME validation, quarantine finalization, malware scanning, signed preview/download or Worker identity/evidence workflows.

## Accepted implementation boundary

- one canonical `platform_secure_files` metadata store introduced by migration `0011_secure_file_foundation`;
- opaque server-generated secure-file IDs, server-derived reservation keys and server-derived fixed-root object keys;
- no file bytes, base64 payloads or object bodies in relational storage;
- exact account/fixed-role ownership plus Company tenant/membership scope;
- live session revalidation and live Company membership/tenant revalidation before metadata access;
- direct owner/role/tenant/membership SQL predicates with non-enumerating copied-ID denial;
- immutable file identity, ownership, display metadata and storage provenance;
- explicit lifecycle vocabulary reserved for later M1.06 processing: `reserved`, `quarantined`, `scan_pending`, `available`, `unsafe`, `scan_failed`;
- database-enforced lifecycle transition and content-provenance invariants;
- idempotent logical reservation under retry/concurrency;
- provider-neutral private object-storage interface with one accepted `local_test` adapter;
- application storage root fixed to `.data/private-objects` beneath server authority;
- exact opaque object-key allow-list, no public URLs/network storage, no arbitrary roots or browser-selected paths;
- same-key/same-bytes object writes are idempotent; same-key/different-bytes writes fail closed;
- symlink directory/object escapes rejected before outside directory creation or object access;
- deterministic owned migration rollback/reapply and persistent PGlite close/reopen proof;
- full repository engineering gate coverage.

## Deliberate scope boundary

Subunit 1 reserves metadata/storage authority only. A reservation is not a successful upload and does not create a material evidence/audit event. Material file lifecycle audit/outbox integration begins only when Subunit 2 actually accepts validated bytes into quarantine. This avoids falsely recording evidence work that has not happened.

## Regressions discovered and protected

- `REG-036` — metadata-only reservation must not prematurely mutate accepted M1.05 audit/outbox vocabulary.
- `REG-037` — application callers must not choose their own trusted local-storage base/root.
- `REG-038` — lexical path containment is insufficient; symbolic-link paths/objects must fail closed before any escaped write side effect.
- inherited `REG-027` — accepted migration tests must remain forward-compatible when later migrations are added.
- inherited `REG-033` — tests must use valid lower-layer SHA-256 fixtures rather than weakening database constraints.
- inherited `REG-035` — source guards assert security semantics rather than guessed source spelling.

Detailed regression record: `docs/engineering/M1_06_SUBUNIT1_REGRESSIONS.md`.

## Final acceptance evidence

- Accepted base main: `e3b80934012b6f473945e59eff5d902ef14cc190`
- Implementation PR: `#47`
- Hardened implementation head: `80755684278365daabfc572990ddcf992e722434`
- Hardened engineering run/job: `31326798669 / 93278355271` — **PASS**
- Exact final PR head: `aefc1283922e40d2f6e3bc375e45a8c5ce1693eb`
- Final PR engineering run/job: `31327013176 / 93278912641` — **PASS**
- Implementation merge: `e2c2a748fd7d3b168517809f04f0d7d19c206f34`
- Merged-main engineering run/job: `31327264168 / 93279514688` — **PASS**
- Final acceptance record: `docs/testing/results/M1_06_SECURE_FILE_FOUNDATION_FINAL_ACCEPTANCE.md`

## Owner test decision

No owner/browser test was required for Subunit 1 because it added no browser-visible workflow. The meaningful acceptance was the exact-head and merged-main automated storage/database/security gate.

## Next subunit

M1.06 remains **IN PROGRESS** and Phase 1 remains **5 of 12 Milestone 1 bricks DONE**. After this closure record itself is merged and green on `main`, **M1.06 Subunit 2 — Isolated Upload Intake, Validation and Quarantine** becomes the only permitted next build unit.
