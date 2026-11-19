# M1.11.03 — Skill review Worker notification receiving and permission/forgery checks (2026-11-19)

**Starting signed QA:** `98e82b218da8bbbc00d5be2f1d12fbf505d8f20c` after PR163, all **70/70 exact-SHA GitHub workflows PASS** (M10601 artifact-upload HTTP timeout rerun at identical SHA recovered; original raw browser 1/1). **Frozen release 0/218 FULLY_VERIFIED, NO-GO.** This test is one scoped source case, not complete scenario or production-provider proof.

## Actual local runtime assertions

- Disposable isolated PGlite, real `WorkerEvidenceService`, `EvidenceReviewService`, review-calibration fixture, actual `platform_outbox_jobs`, projection stored procedures, `DatabaseNotificationRepository`, immutable DB and href resolver.
- Worker submits skill v1. Independent Verifier decides `CHANGES_REQUESTED`. Exactly one `evidence.additional.requested` intent and a separate email intent source-bound to the immutable decision. Twice projecting the actual job produces **one** Worker portal notice. Exact Worker href `/worker/evidence#<recordId>`.
- Unauthorized Verifier and separately authorized foreign Worker cannot find or mark read the copied Worker notice. Original Worker read succeeds once, repeated read is idempotent.
- Worker submits corrected skill v2; independent calibrated Verifier decides `APPROVED`. Exactly one `evidence.reviewed` Worker notification, exact owned record href, foreign denied, projection replay idempotent. Two distinct immutable version-bound decisions, v1 superseded and v2 current.
- Forged outbox idempotency key and direct mutation of retained notice body rejected. Four explicit machine markers; **1/1 local PASS**, original `tests/platform/assurance-event-notification-producer-runtime.test.mjs` **13/13 local PASS**.

## Trust and remaining gates

- CI file `.github/workflows/m1-11-03-skill-notice-runtime.yml` checks four markers and 1/1 + adjacent original notification regression on exact PR/SHA and retains both raw logs 90 days. **Hosted CI and actual merged SHA not yet run for this new source case.** Original source evidence index now accurately 1,607 unique (previous 1,606 fully retained), 1,433 historical green, 174 without matched old logs. Do not count the new local 1/1 in historical green nor mark the scenario FULL.
- Actual browser clicking in Worker notice list and bell, Company authorized receiving and wrong-tenant API, interrupted job delivery, live provider email, final protected staging, full independent penetration test, load/restore and Owner UAT remain to test. Real email provider acceptance/delivery cannot be inferred from the locally created email intent.

**NEXT:** exact head hosted PGlite 1/1 and adjacent13/13 raw SHA256 verification; guarded normal signed QA merge and 100% exact merged SHA CI, then continue cross-role/API/browser notice and external gates.
