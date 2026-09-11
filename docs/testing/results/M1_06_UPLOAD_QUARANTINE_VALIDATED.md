# M1.06 Subunit 2 Validation Record

## Gate status

**VALIDATED — PENDING MERGED-MAIN ACCEPTANCE**

Date: 9 August 2026

## Scope

M1.06 Subunit 2 — Isolated Upload Intake, Validation and Quarantine.

This record covers the server-only validation, private object staging, stored-content confirmation and atomic `reserved -> quarantined` transition. It does not claim malware scanning, `available` state, signed preview/download, browser upload UI or M1.07 evidence workflows.

## Exact evidence

- Accepted base main: `9fffd8e0bc479a19db6093052a219662c29ca7be`
- Draft implementation PR: `#49`
- Frozen validated behavioral head: `f18ed46e994c26912f71ce5d621f15125c7191ab`
- Engineering workflow run: `31331804583`
- Validation job: `93291157241`
- Conclusion: **PASS**
- Review threads at behavioral freeze: none
- PR comments at behavioral freeze: none

## Validated security/engineering behavior

- exact authenticated reservation scope is revalidated before quarantine finalization;
- copied cross-account/cross-role/cross-tenant file IDs do not grant access;
- revoked sessions and inactive Company scope fail closed;
- browser/request fields cannot choose storage key, owner scope, detected MIME, content hash, content size, provider or lifecycle;
- PDF, PNG and JPEG validation uses independent filename extension, declared MIME, detected byte structure and size controls;
- PDF final EOF, PNG CRC/IHDR/IEND and JPEG frame/scan/EOI structural rules have direct regressions;
- valid incremental PDFs remain accepted when the final EOF boundary is valid;
- untrusted bytes are copied before validation capability issuance;
- server computes SHA-256 and byte size;
- private storage exact-key staging is retry-safe for identical content and rejects different-content replacement;
- durable object stat must match the validated hash/size before database finalization;
- identical filenames in separate reservations cannot cross-link object keys;
- concurrent finalization cannot advance one reserved row more than once;
- successful quarantine writes immutable provenance and one material `secure_file.quarantined` audit fact;
- real repository runtime proof demonstrates the metadata transition and audit insert share one transaction;
- forced audit insertion failure rolls all quarantine metadata back to the reserved state;
- exact same-content repository replay is idempotent and does not duplicate the audit fact;
- conflicting replay cannot replace quarantined provenance;
- migration 0012 is forward-stack compatible, reversible without deleting accepted quarantine/audit history, and persistent PGlite close/reopen retains the accepted state;
- no scanner job/outbox type, `scan_pending` transition, `available` transition, public URL, preview or browser route is introduced.

## Defects discovered during build

Permanent regression IDs `REG-039` through `REG-045` are documented in `docs/engineering/M1_06_SUBUNIT2_REGRESSIONS.md`.

The first complete candidate failed because a test asserted database trigger error-message ordering rather than the security outcome. That was corrected as REG-039 without weakening the database guard. Subsequent self-review added duplicate-policy rejection, real repository atomicity execution, incremental PDF compatibility, PNG CRC/IHDR enforcement and JPEG frame/scan structural validation before acceptance.

## Owner/manual test

**Not required for this subunit.** No visible browser workflow was added. The final visible upload experience belongs to later product workflow integration; adding a temporary interface solely for this gate would create non-canonical scope.

## Remaining gate

This is pre-merge evidence only. The final documentation head must pass CI, PR #49 must merge at that exact validated head, merged `main` must pass the complete gate, and a separate closure PR must pass before Subunit 3 is unlocked.
