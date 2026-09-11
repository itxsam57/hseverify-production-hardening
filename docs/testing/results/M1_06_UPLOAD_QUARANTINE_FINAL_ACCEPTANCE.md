# M1.06 Subunit 2 — Final Engineering Acceptance

Date: 9 August 2026

## Decision

**DONE — ENGINEERING PASS**

M1.06 Subunit 2 — Isolated Upload Intake, Validation and Quarantine — is accepted as an internal engineering subunit. No owner/browser test was required because no browser-visible workflow was added.

M1.06 remains **IN PROGRESS** and Phase 1 remains **5 of 12** Milestone 1 bricks DONE.

## Exact acceptance evidence

- Accepted starting main: `9fffd8e0bc479a19db6093052a219662c29ca7be`
- Implementation PR: `#49`
- Frozen behavioral head: `f18ed46e994c26912f71ce5d621f15125c7191ab`
- Behavioral full gate: `31331804583 / 93291157241` — **PASS**
- Exact final documentation head: `2c565d853719e4e53cad3a81ffb6caf9691a0292`
- Final PR gate: `31332058088 / 93291788050` — **PASS**
- Implementation merge commit: `7803dd66599edd88fc9b396447d235246badff90`
- Merged-main full gate: `31332280267 / 93292321486` — **PASS**
- Review threads at merge: none
- PR comments at merge: none

## Accepted behavior

- trusted server upload policy controls content family and maximum size;
- browser/request values cannot choose owner scope, object key, detected MIME, hash, size, provider or lifecycle result;
- PDF/PNG/JPG/JPEG extension, declared MIME, detected structure and byte-size controls are independent and must agree;
- PDF final EOF validation supports incremental revisions without permitting trailing non-whitespace payload;
- PNG signature, chunk bounds, CRC32, IHDR semantics, IDAT ordering and terminal IEND are validated;
- JPEG marker segments, actual frame, scan structure and terminal EOI are validated;
- untrusted bytes are copied before validation authority and SHA-256/size are computed server-side;
- accepted bytes use only the existing server-derived private object key;
- same-content object staging retries are idempotent and different-content replacement fails closed;
- stored object hash/size is verified before finalization;
- live account/role/Company tenant and membership authority is revalidated before file mutation;
- copied cross-scope file IDs fail non-enumerating;
- only `reserved -> quarantined` is permitted in this subunit;
- validated content provenance is immutable after quarantine;
- `secure_file.quarantined` audit persistence is in the same transaction as quarantine metadata;
- the actual repository runtime suite proves forced audit failure rolls the entire quarantine transition back;
- exact same-content replay does not duplicate the material audit fact;
- conflicting replay cannot replace accepted provenance;
- independent upload slots stay isolated under concurrency;
- migration 0012 preserves immutable accepted history through rollback/reapply and persistent restart;
- no malware scan job, safe/available state, signed preview/download, public object URL, browser upload UI or M1.07 workflow was added.

## Permanent regressions

`REG-039` through `REG-045` are protected in `docs/engineering/M1_06_SUBUNIT2_REGRESSIONS.md` and remain part of the complete engineering gate.

## Next permitted build

After this closure PR passes its exact-head gate, merges, and passes the merged-main gate, **M1.06 Subunit 3 — Durable Malware Scan Job and Local/Test Scanner Adapter** becomes the only permitted implementation unit.

Subunit 4, Subunit 5 and M1.07+ remain blocked.
