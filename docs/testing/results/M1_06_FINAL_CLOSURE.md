# M1.06 Final Brick Closure

Status: **CLOSURE TRANSITION — PENDING EXACT-HEAD / MERGED-MAIN GATES**

## Brick

M1.06 — Secure Storage and Upload Pipeline.

## Accepted implementation evidence

- Subunits 1–4 were independently accepted before the final cumulative unit.
- Subunit 5 exact implementation head: `86d135f87a2a2b53f12b8d5b1a2438944cd426fc`.
- Subunit 5 exact-head complete engineering gate: run `31362444454` — PASS.
- PR #55 merged with expected-head SHA lock.
- Resulting implementation merge on `main`: `4ee689e244c938d04a7db3d58306cff8e20b6213`.
- Merged-main complete engineering gate: run `31362848897` — PASS.
- Final acceptance evidence: `docs/testing/results/M1_06_FINAL_ACCEPTANCE.md`.
- Acceptance evidence commit: `03ac4ac48ee8477833999829c56f829365b92a9e`.
- Complete engineering gate on that evidence-only main commit: run `31363206957` — PASS.

## Process note

The final acceptance evidence file was accidentally committed directly to `main` before the formal closure branch was created. That commit changed only the acceptance record; it did not change product/runtime code and did not mark M1.06 DONE. The mistake was not hidden: the exact commit was subjected to the complete `main` engineering gate and passed. The actual M1.06 status transition remains isolated in `build/m1-06-final-closure` and must pass its own exact-head PR gate, exact-head merge lock and merged-main gate before this record can be changed to CLOSED.

## Accepted M1.06 behavior

The brick now has permanent automated proof for:

- server-generated opaque secure-file identity and private object storage;
- exact account/role/Company tenant/membership scope;
- independent PDF/PNG/JPEG extension, declared MIME, detected structure/signature and byte-size validation;
- private quarantine with immutable SHA-256/size/object provenance;
- durable malware scan scheduling, lease/retry/reclaim/terminal recovery and deterministic local/test scanner fixtures;
- guarded `scan_pending -> available|unsafe|scan_failed` lifecycle;
- `available`-only signed preview/download with purpose/session/account/role/tenant binding;
- use-time live authorization and final private-byte size/SHA revalidation;
- expected access denial separated from database/private-storage infrastructure failure;
- no public object URLs, no browser-selected storage/provider/object/tenant authority and no raw bytes in relational/audit state;
- Worker and Company end-to-end composition on one persistence boundary;
- malicious evidence remaining unsafe and post-scan private-object tampering denied;
- persistent PGlite/private-object close/reopen recovery;
- deterministic complete M1.06 rollback/reapply while preserving immutable earlier/later history;
- exact approved checksum repair for historically accepted replay migrations 0012 and 0013, with unknown/tampered checksum drift still fail-closed.

## Permanent regressions

- Subunit 4: REG-055 through REG-069.
- Subunit 5: REG-070 through REG-072.

These remain required by the complete engineering gate after M1.06 closes.

## Owner/browser requirement

The final cumulative M1.06 unit and this closure transition introduce no browser-visible product surface. Owner browser testing is **NOT REQUIRED** for this closure. This does not waive browser testing for M1.07; the final Worker Identity UX is visible and M1.07 cannot close without owner/browser acceptance.

## Closure transition

This branch changes the canonical build position only:

- M1.06: IN PROGRESS -> DONE.
- Milestone 1: 5/12 -> 6/12 DONE.
- M1.07: BLOCKED -> READY TO BUILD.
- M1.08+: remain BLOCKED.

No M1.07 product code is permitted until this closure branch passes exact-head verification, merges without drift and the resulting `main` commit passes the complete engineering gate.
