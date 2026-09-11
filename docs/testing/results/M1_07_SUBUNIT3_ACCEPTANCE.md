# M1.07 Subunit 3 Acceptance

## Unit

**M1.07 — Worker Onboarding and Identity Engine**  
**Subunit 3 — Secure Identity Document, Profile Photo and Selfie Evidence Binding**

## Result

**ENGINEERING PASS — 10 August 2026**

No browser/owner test is required for this subunit because it introduces no browser-visible route or product surface. The genuine M1.07 live-test boundary remains Subunit 6 when `/worker/identity` becomes visible and interactive.

## Exact evidence

- Implementation PR: `#61`
- Accepted exact head: `db40d8be93b1ea9064f86a16e2e1915d11b67d96`
- Exact-head engineering gate: `31384894092` — **PASS**
- Merge commit: `00e92e967deedee6e5682423b74a8f26acaa2617`
- Merged-main engineering gate: `31385318724` — **PASS**

## Accepted behavior

- Identity document, profile photo and selfie evidence reuses the accepted M1.06 secure-file domain; S3 does not introduce a second upload/storage pipeline.
- Identity evidence rows store only an opaque `secure_file_id` plus identity metadata. Raw bytes, base64, storage object keys, content hashes, reservation keys, storage-adapter details and signed-access material remain in M1.06.
- Binding is allowed only for the authenticated active Worker, current editable identity version and an `available` M1.06 file owned by that same Worker with Worker role and null tenant/membership scope.
- Service preflight, repository transaction and SQL insert trigger independently enforce the evidence authority boundary.
- Profile photo and selfie evidence requires detected PNG/JPEG content. PDF is not accepted for those purposes.
- Identity-document metadata supports passport, national ID and residence permit with normalized document number and safe issue/expiry ordering.
- Exactly one active binding exists per identity-version/purpose. Replacements preserve the previous row as `superseded` with explicit lineage.
- Exact retries are idempotent. Materially different replacements require the active binding ID observed by the caller; stale edits fail instead of silently winning.
- Submitted evidence is frozen and non-deletable. Later correction work must create a new identity version rather than rewrite accepted history.
- S3 submission readiness requires one current available identity document, profile photo and selfie in addition to S2 personal/contact readiness.
- There is deliberately no physical foreign key from durable identity evidence history to `platform_secure_files`; binding/submission authority is validated live without making M1.07 history own M1.06 table lifetime.
- S3 rollback/reapply is monotonic and evidence history survives PGlite close/reopen.
- S2 remains pinned to migration `0016`; S3 layer tests stop at `0018_worker_identity_evidence_freeze_guard`; the complete application/release gate continues to apply the whole current migration stack.

## REG-075 root-cause evidence

The first S3 diagnostic gate `31383684472` correctly exposed a test-architecture defect: the S3 fixture attempted to manufacture `scan_pending` without the accepted M1.06 secure-file scan generation/outbox-job binding. M1.06 rejected it with `Secure file initial scan binding is invalid.` A second fixture path could reuse a verified phone value.

The root fix did **not** weaken M1.06. S3 fixtures now create a real pending `secure_file.scan` outbox job, bind its generation/job ID before the lifecycle can advance, then reach `available`; Worker contacts are deterministic and unique. `scripts/check-worker-identity-evidence.mjs` permanently protects this upstream lifecycle contract. REG-075 is recorded in `docs/engineering/M1_07_SUBUNIT3_REGRESSIONS.md`.

A later failed run contained only a brittle English regex for the existing immutable-history delete error. That assertion was made semantic without production changes and was not classified as a new independent defect.

## Next gate

Subunit 3 is formally closed only after this closure branch passes the full exact-head gate, merges with an expected-head SHA lock, and the resulting `main` commit passes the full engineering gate.

After that, **Subunit 4 — Automated Identity Checks and Provider Adapter Boundary** is the only permitted next internal unit. M1.08 and later bricks remain blocked.
