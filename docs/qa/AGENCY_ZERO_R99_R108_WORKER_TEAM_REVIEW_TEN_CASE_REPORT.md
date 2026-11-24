# ZERO R99–R108 — Company Team, Worker invitations and independent review

**Ten unique original Masterplan IDs, one original named test per R batch, 10/10 actual SCOPED PASS, 0/218 TECH FULL.**

All source cases used a clean detached `7ff30ea140a5145e5d5ba761f7c7aef24c895269` official application source, Git tree `e01d07918a03b78a76830b52d8ab67d853c96148`. QA evidence branch carries two inherited unapproved R36/R40 Company source alterations that correctly fail official candidate CI policy. No app source, production or shared protected stage was modified.

Runtime configuration fingerprint SHA256 `d0a85535ab0d337a402dea6d74c10bd0f158fe7053d4191f8a8cdaf008481026`. Physically separate SCRAM-authenticated PostgreSQL16 localhost-only disposable cluster (not shared stage) for R103/R104/R106; other cases used local real Chromium and isolated synthetic fixture DB. One actual TAP test per batch; zero skipped, failed or timed-out cases.

## Ten bounded original scenario results

### R99 — M1.09.05 — SCOPED PASS 1/1

**Original workflow:** Suspension/revocation removes existing-session access.
**Exact source case:** `tests/browser/m10905-company-team-session-revocation.browser.test.mjs :: M1.09.05 actual Chromium owner suspends Company Team and old worker-scope session cannot reenter after reactivation`.
- **ENGINEER — SCOPED PASS:** Owner suspends Company Team Manager using real UI; old session redirected, reactivation demands new MFA session, later revocation removes that cookie and records immutable audits.
- **CYBERSECURITY — tested-boundary SCOPED PASS:** Old cached and fresh revoked tokens rejected; session resurrection after reactivation denied.
- **REVIEWER — scoped evidence accepted, full not attested:** One tested Company Team suspension/revocation Chromium/DB workflow; full across six roles and third-party MFA adapter unverified.
- **Evidence:** app SHA `7ff30ea140a5`, original source test SHA256 `4329dfe695108eab3658546afa618b93930f07722ae954da2fd08e406d6bb768`, raw private log SHA256 `a233a2294aef3ba7cc1509bc265e8241f17a62275825f9b8e66c6697f857fc3f`; TAP 1 PASS, 0 FAIL, 0 skipped, exit 0.

### R100 — M1.09.06 — SCOPED PASS 1/1

**Original workflow:** Company staff cannot grant permissions above own ceiling.
**Exact source case:** `tests/browser/m10906-company-team-live-grant-ceiling.browser.test.mjs :: M1.09.06 actual Chromium Owner removes Admin live grant while stale Admin Manager and invitation forms cannot delegate it`.
- **ENGINEER — SCOPED PASS:** Owner reduces Admin workforce management grant; real stale Manager and invitation forms cannot delegate excess authority; current reload shows reduced ceiling and correct audits.
- **CYBERSECURITY — tested-boundary SCOPED PASS:** Permission ceiling enforced on server for stale role forms and stale invites; no forged higher grant or duplicate mutation.
- **REVIEWER — scoped evidence accepted, full not attested:** One real two-Company-staff permission change path; all mobile/keyboard/tenant role variants not fully certified.
- **Evidence:** app SHA `7ff30ea140a5`, original source test SHA256 `6e43501949224c7f4a7b8844ba3ec3f5d7313be666e9e7a0f0be40ee03e4ef72`, raw private log SHA256 `4fa1cbdff36acd80d8549a065159c268ebf6be962330e1bb64aca7a54ed6195a`; TAP 1 PASS, 0 FAIL, 0 skipped, exit 0.

### R101 — M1.10.01 — SCOPED PASS 1/1

**Original workflow:** Single invitation accepted, resent, revoked, expired and replayed.
**Exact source case:** `tests/browser/m11001-company-worker-invitation-lifecycle.browser.test.mjs :: M1.10.01 real Chromium Company Worker invitation acceptance resend revocation expiry wrong role email and replay`.
- **ENGINEER — SCOPED PASS:** Company owner creates/duplicates/resends/revokes/expires invitation; rightful Worker accepts and Company sees acceptance after reload.
- **CYBERSECURITY — tested-boundary SCOPED PASS:** Wrong email, wrong role, expired, revoked, spent and replayed token attempts blocked; rotation invalidates old links.
- **REVIEWER — scoped evidence accepted, full not attested:** Real browser single-invite lifecycle with synthetic mail links, external actual email delivery not verified.
- **Evidence:** app SHA `7ff30ea140a5`, original source test SHA256 `4612cdfe6b933ac9cd69c885a65cc01a9e2552acca19ea03152703e0bf668d92`, raw private log SHA256 `4360c66b57d11351745ebc214cb4eaf55627f774d99f8cb013c225cb76b252dd`; TAP 1 PASS, 0 FAIL, 0 skipped, exit 0.

### R102 — M1.10.02 — SCOPED PASS 1/1

**Original workflow:** Bulk CSV mixed valid/invalid rows and duplicate recovery.
**Exact source case:** `tests/browser/m11002-company-bulk-worker-csv.browser.test.mjs :: M1.10.02 real Chromium bulk CSV quoted valid, malformed, duplicate, empty-first-cell, retry and Worker receiver persist per row`.
- **ENGINEER — SCOPED PASS:** Company mixed quoted/malformed/duplicate/empty CSV processes per-row acceptance/errors; corrected CSV retries and Worker receiver observe exact state.
- **CYBERSECURITY — tested-boundary SCOPED PASS:** CSV injection-like content inert, 501-row overflow and unauthenticated/wrong role denied, no duplicate reserved Worker links.
- **REVIEWER — scoped evidence accepted, full not attested:** Real Chromium Company and Worker row/audit checks, no full high-volume CSV/load analysis.
- **Evidence:** app SHA `7ff30ea140a5`, original source test SHA256 `035ffaf341297b840ee99aaa5cf703d8bd027a1f08dd46fbefdf19bd77495dd1`, raw private log SHA256 `305bd9dba1de37c50532e3ee4b662f11b3bad8a6f5d993f49ab6fcfcc146a422`; TAP 1 PASS, 0 FAIL, 0 skipped, exit 0.

### R103 — M1.10.03 — SCOPED PASS 1/1

**Original workflow:** Company code expiry/usage limit/default site and department.
**Exact source case:** `tests/platform/company-worker-invitations.test.mjs :: M1.10.03 actual PostgreSQL16 Worker last-slot race enforces code expiry usage/default Site Department and immutable cross-role audit`.
- **ENGINEER — SCOPED PASS:** Two actual PG16 Worker sessions compete for final Company code slot; exactly one accepted, defaults enforce site/department and cross-role audit.
- **CYBERSECURITY — tested-boundary SCOPED PASS:** Expired/tampered/revoked code, wrong-role/foreign tenant and usage-limit bypass rejected with atomic idempotency.
- **REVIEWER — scoped evidence accepted, full not attested:** Real isolated PG16 last-slot race, external message delivery not tested.
- **Evidence:** app SHA `7ff30ea140a5`, original source test SHA256 `cc99e417a84bb398052fd23d4c7247c6efb2aa584f8e9eecb2877d0c171a1792`, raw private log SHA256 `3f386be8269c0b07a0f16191b5f38048ce2d7c99f725a58cad5cbbdf92f2e8a2`; TAP 1 PASS, 0 FAIL, 0 skipped, exit 0.

### R104 — M1.10.04 — SCOPED PASS 1/1

**Original workflow:** Unlinked/wrong Worker cannot accept another person's invitation.
**Exact source case:** `tests/platform/company-worker-invitations.test.mjs :: M1.10.04 actual PostgreSQL16 wrong Worker copied link ID cannot accept during rightful cross-tenant Worker race`.
- **ENGINEER — SCOPED PASS:** Rightful Worker accepts copied-link invitation once while foreign Worker attempts collision in independent PG16 sessions.
- **CYBERSECURITY — tested-boundary SCOPED PASS:** Cross-company link-ID BOLA, forged/revoked session and wrong-worker acceptance denied; no cross-tenant persisted result.
- **REVIEWER — scoped evidence accepted, full not attested:** Real two-tenant/Worker PG16 concurrency security; full browser copy/paste/notifications outside this one case.
- **Evidence:** app SHA `7ff30ea140a5`, original source test SHA256 `cc99e417a84bb398052fd23d4c7247c6efb2aa584f8e9eecb2877d0c171a1792`, raw private log SHA256 `8b4fdf85222ea68bbb427e6ed32eed71611fa08b1accdbdbbe89ec46507ca902`; TAP 1 PASS, 0 FAIL, 0 skipped, exit 0.

### R105 — M1.10.05 — SCOPED PASS 1/1

**Original workflow:** Worker joins, moves placement, ends relationship and retains identity.
**Exact source case:** `tests/browser/company-worker-end-relationship.browser.test.mjs :: Company ends active Worker relationship while Worker retains identity and prior Company history`.
- **ENGINEER — SCOPED PASS:** Company ends active Worker link and Worker retains permanent identity, relationship history and previous Company evidence.
- **CYBERSECURITY — tested-boundary SCOPED PASS:** Terminated Company cannot access new Worker scope and historical records remain tenant-bound.
- **REVIEWER — scoped evidence accepted, full not attested:** One real browser company-end workflow; complete multi-employer transfer native and cross-role UI receive not all attested.
- **Evidence:** app SHA `7ff30ea140a5`, original source test SHA256 `45a39a25a940428aecd6192c53002c7f264e3261dc3cf7efb7a7f217a77547e8`, raw private log SHA256 `0866c057981060b38da9f13aba4e0cd8c76f5e967b2f86bec9c4c41193ddeae5`; TAP 1 PASS, 0 FAIL, 0 skipped, exit 0.

### R106 — M1.10.06 — SCOPED PASS 1/1

**Original workflow:** Second company link preserves first employer's history and isolation.
**Exact source case:** `tests/platform/company-worker-invitations.test.mjs :: M1.10.06 actual PostgreSQL16 two simultaneously active employers retain independent Worker scope during cross-company end and placement`.
- **ENGINEER — SCOPED PASS:** Two simultaneously linked Companies independently accept same Worker with one ID; ending one relationship leaves other placement active and retains audits.
- **CYBERSECURITY — tested-boundary SCOPED PASS:** Concurrent cross-employer end versus site move preserves tenant-bound grants; foreign and replayed mutations denied.
- **REVIEWER — scoped evidence accepted, full not attested:** Real PG16 two-employer relationship race; external company adapter and all Worker UI variants still open.
- **Evidence:** app SHA `7ff30ea140a5`, original source test SHA256 `cc99e417a84bb398052fd23d4c7247c6efb2aa584f8e9eecb2877d0c171a1792`, raw private log SHA256 `4251aa38571cbddae0ae0d847142977c4ec89951b1ccdad1cc6aada87365bfbd`; TAP 1 PASS, 0 FAIL, 0 skipped, exit 0.

### R107 — M1.11.01 — SCOPED PASS 1/1

**Original workflow:** Qualification approval/rejection/changes requested to correction and re-review.
**Exact source case:** `tests/browser/company-workforce-assurance-e2e.browser.test.mjs :: Company organization, Worker invitation/link, Assurance Order and case-scoped Verifier review work end-to-end`.
- **ENGINEER — SCOPED PASS:** Real browser Company organization, Worker invitation/link, Assurance Order, Verifier case assignment, qualification changes requested to corrected approval; case advances.
- **CYBERSECURITY — tested-boundary SCOPED PASS:** Independent case-source version proof and audit prevent reviewing unrelated Worker evidence; historical v1/v2 decisions preserved.
- **REVIEWER — scoped evidence accepted, full not attested:** Company/Worker/Verifier real browser workflow, local PGlite and scanner fixtures; live external identity/payment/video providers not proven.
- **Evidence:** app SHA `7ff30ea140a5`, original source test SHA256 `6d4418c593d42f2648b82123b19bf48100038786d003e37ef0ec0340afe18f86`, raw private log SHA256 `21e06d43ee605185c8158194fb43576b38df33f8468c986dd3b198de67673614`; TAP 1 PASS, 0 FAIL, 0 skipped, exit 0.

### R108 — M1.11.02 — SCOPED PASS 1/1

**Original workflow:** Experience approval/rejection/changes requested to correction and re-review.
**Exact source case:** `tests/browser/independent-worker-review-e2e.browser.test.mjs :: independent Worker submissions reach Verifier and approve/reject/changes-requested outcomes return to Worker UI`.
- **ENGINEER — SCOPED PASS:** Real Worker submission and independent Verifier review outcomes return to Worker UI across qualification, experience and related review branches.
- **CYBERSECURITY — tested-boundary SCOPED PASS:** Tested role limits, version-bound decisions, auth and evidence retry/approval paths; full application pentest and every adapter still open.
- **REVIEWER — scoped evidence accepted, full not attested:** One broad real Worker/Verifier Chromium test, not an independent signed 218-scenario review or provider-live contract.
- **Evidence:** app SHA `7ff30ea140a5`, original source test SHA256 `b2edf7f39903f8a8012026cc9780f0772738d532ead3cecdd5a41bc56c4a3ba9`, raw private log SHA256 `3f57f8d927ed0c02d8c25d96144d2d46efde00cc0d74c7efac91a24f625df6fe`; TAP 1 PASS, 0 FAIL, 0 skipped, exit 0.

## Evidence preservation and outstanding release requirements

- Private exact ten original case receipts `/home/ubuntu/work/.hse-qa-tmp/agency-zero-r99-r108/R99-R108-three-role-evidence-receipts.json` SHA256 `a1f90014a546c4120c9d7296ab8ad0d085c569df32a6a9ab75bd1a44da8035a4`; runner progress raw SHA256 `06b551ef5e078f60b4eb12aeef098b8950afd842c94b36d5c8c93e978bc59a13`; private PostgreSQL16 clean teardown SHA256 `a12a28f42f723e0425dafee9f4a48f405001a7057da3285f856ae836abac3529`. No private DSN/password or raw snapshots committed.
- Three specialist disciplines assessed by this AI QA process, **not three separately identified human reviewer signatures**. Each SCOPED PASS remains bound to exact 7ff source/config; no complete positive/negative/cancel/retry/a11y/adapter/real provider or independent penetration claim for entire original scenarios.
- Existing 218 original scenarios and initial 58 batch groups untouched. Historic 1436/1611 green source cases and 4975 planned check slots cannot become final technical signoff from these targeted cases. Technical fully verified **0/218**.
- **Release blockers still open:** two inherited unapproved Company source differences, intentionally red CI guard, no separately signed source-to-built binary, stage metadata stale/current stage strict SHA restart mismatch, no retained fresh encrypted verified backup or approved operator rollback window; actual email/SMS/identity/video/scanner/storage/payments providers and penetration/load/recovery staging work remain open. Production unchanged.

**NEXT R109:** M1.11.03–.08 evidence and employment/skill/supervisor review, additional original Workflows where source links absent, then M1.12. Maintain <=5 cases/workflows per batch, full three-discipline gating, no silent candidate re-pin.

**OWNER TESTING READY NO | FULL 0/218 | PRODUCTION UNCHANGED.**
