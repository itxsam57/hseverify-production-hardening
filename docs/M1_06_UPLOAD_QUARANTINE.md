# M1.06 Subunit 2 — Isolated Upload Intake, Validation and Quarantine

## Status

**DONE — ENGINEERING PASS — 9 August 2026**

This subunit accepts bytes only for an already-authorized secure-file reservation, validates them independently from browser claims, writes them to the reservation's private object key, confirms the durable stored content, and atomically advances the file from `reserved` to `quarantined` with its first material secure-file audit fact.

It deliberately does **not** implement malware scanning, scan jobs, safe/available state, signed preview/download, Worker identity/evidence workflow, or M1.07+ product behavior.

## Accepted implementation boundary

- one server-only upload/quarantine service bound to the accepted M1.06 Subunit 1 secure-file authority;
- request/browser inputs are limited to untrusted bytes, original filename and declared MIME plus an opaque existing file reference;
- owner account, fixed role, Company tenant/membership, storage adapter, object key, detected MIME, byte size, SHA-256 and lifecycle state remain server/database authority;
- non-copyable trusted upload policy capability controls accepted content families and maximum size;
- platform hard ceiling is 25 MiB and the current default local/test evidence policy is 10 MiB;
- accepted families are PDF, PNG and JPEG (`.jpg` / `.jpeg` both map to `image/jpeg`);
- extension, declared MIME, detected content structure and size are separate checks and must agree;
- untrusted input bytes are copied before validation authority is issued, preventing caller mutation after validation;
- SHA-256 and byte size are computed server-side;
- PDF detection requires `%PDF-` at byte zero and a final terminal `%%EOF` boundary with only ASCII whitespace after it; earlier EOF markers are permitted for legitimate incremental revisions;
- PNG detection validates exact signature, chunk boundaries, per-chunk CRC32, semantic IHDR fields, IDAT ordering and exact terminal zero-length IEND;
- JPEG detection validates bounded marker segments, at least one valid SOF frame with non-zero dimensions, at least one valid SOS scan header, scan marker handling and exact terminal EOI;
- path-like filenames, unsupported extensions, declaration/content mismatches, truncation, impossible structures and trailing bytes fail closed;
- accepted bytes write only to the already server-derived private object key;
- same-key/same-bytes staging is idempotent while same-key/different-bytes replay fails closed;
- the stored object is statted again and its exact SHA-256/size must match the validated content before finalization authority is issued;
- staged bytes are intentionally retained when database finalization fails so an exact same-content retry can recover; blind cleanup cannot break the logical reservation;
- quarantine finalization revalidates live session/account/role and exact Company tenant/membership state transactionally;
- copied file IDs across accounts/roles/tenants return non-enumerating denial;
- database finalization locks the exact secure-file row and permits only `reserved -> quarantined`;
- file extension, declared MIME, detected MIME, byte size and SHA-256 become immutable validated content provenance once quarantined;
- successful quarantine and `secure_file.quarantined` audit insertion occur in the same database transaction;
- exact same-content repository replay returns the existing quarantine without creating a duplicate audit fact;
- conflicting replay cannot replace accepted bytes/provenance;
- a forced audit-insert failure rolls the file row back to `reserved`, proving there is no unaudited quarantine state;
- independent upload slots remain isolated even when display filenames are identical and finalization is concurrent;
- migration `0012_secure_file_upload_quarantine` adds only the immutable audit action/target vocabulary needed for this material lifecycle event;
- its rollback deliberately preserves the expanded audit vocabulary so accepted immutable history cannot become invalid;
- no outbox scanner job is created and no file reaches `scan_pending` or `available` in this subunit;
- no public URL, preview/download route, scanner service, browser upload UI or M1.07 evidence workflow is introduced.

## Regressions discovered and permanently protected

- `REG-039` — assert prohibited mutation outcome and retained provenance, not database trigger error ordering.
- `REG-040` — reject duplicate allowed-kind entries in trusted upload policies.
- `REG-041` — execute the real quarantine repository and prove metadata/audit atomic rollback.
- `REG-042` — accept legitimate incrementally updated PDFs by validating the final EOF boundary rather than requiring one historical EOF marker.
- `REG-043` — validate every PNG chunk CRC.
- `REG-044` — reject JPEG wrapper-only data; require an actual bounded frame and scan structure.
- `REG-045` — validate PNG IHDR semantics and IDAT ordering.

Detailed record: `docs/engineering/M1_06_SUBUNIT2_REGRESSIONS.md`.

## Final acceptance evidence

- Accepted base main: `9fffd8e0bc479a19db6093052a219662c29ca7be`
- Implementation PR: `#49`
- Frozen validated behavioral head: `f18ed46e994c26912f71ce5d621f15125c7191ab`
- Behavioral gate: `31331804583 / 93291157241` — **PASS**
- Exact final PR head: `2c565d853719e4e53cad3a81ffb6caf9691a0292`
- Final PR gate: `31332058088 / 93291788050` — **PASS**
- Implementation merge: `7803dd66599edd88fc9b396447d235246badff90`
- Merged-main gate: `31332280267 / 93292321486` — **PASS**
- Review threads/comments at merge: none
- Owner/browser test: **NOT REQUIRED — no browser-visible workflow**
- Final acceptance record: `docs/testing/results/M1_06_UPLOAD_QUARANTINE_FINAL_ACCEPTANCE.md`

No unresolved release-blocking Subunit 2 defect remains.

## Next gate

M1.06 remains **IN PROGRESS**. Subunit 3 — Durable Malware Scan Job and Local/Test Scanner Adapter — is the next internal build unit only after this documentation closure is itself green on merged `main`. Signed preview/download and M1.07+ remain blocked.
