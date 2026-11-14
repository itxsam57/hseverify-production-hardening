# M3.12.02 — Admin handover is not release authorization (2026-11-09)

**Status: scoped local fix only. FULLY VERIFIED 0/218; PENTEST INCOMPLETE; RELEASE NO-GO.**

Source QA head at start: `ccd3d85eb2725ef01470833461d0907b93688416`.
Isolated worktree: `hseverify-m312-release-readiness-20261109`.
Branch: `qa/m312-release-readiness-failclosed-20261109`.

## Reproduced real browser defect

- A real signed-in Admin could mark the five handover checks `runbook`, `support`, `alerts`, `rollback`, `acceptance` **passed**, at which point the Admin page's top-level label said **Release readiness: ready**.
- That label was derived entirely from Admin-controlled checkboxes, without proving 218 scenarios, real provider delivery, independent pentest, operational alerting/rollback, final staging SHA or Owner acceptance.
- RED proof: `.autopilot/artifacts/M312_READINESS_BROWSER_RED2.log` (real Chromium on QA source SHA, expected independent NO-GO, observed `Release readiness: attention`). The earlier `M312_READINESS_BROWSER_RED.log` was only a mistaken test route expectation: signed-in Root correctly reached `/access-denied`, not `/admin/login`.

## Scoped change and test

- The Admin page separates **Handover checklist: attention/ready** (self-attested, persisted state) from the independent **Release authorization: NO-GO**.
- Copy explicitly explains that the checklist cannot authorize consumer release and lists missing independent gates. No invented stage or provider signoff and no change to other roles' data.
- A source-domain comment warns against using `buildReleaseReadinessSnapshot` as a final release decision.
- Actual Chromium: anonymous Admin access denied, signed-in Root direct Admin access denied, Admin MFA enrollment/sign-in, all five real forms submitted, second stale tab denied with conflict, persisted revisions and audit displayed, 390px responsive layout, handover ready but release NO-GO. Green proof: `.autopilot/artifacts/M312_READINESS_BROWSER_GREEN.log`, **1/1 PASS**.
- Native `production-launch-operations-runtime` **3/3**, `production-launch-handover-runtime` **3/3**, `admin-operational-health-security-runtime` **1/1**; all PASS. Strict TypeScript exit 0. Lint exit 0 with 9 pre-existing warnings, 0 errors. Receipts `.autopilot/artifacts/M312_READINESS_QUALITY_*.log`.
- Additional browser assertions now explicitly require all six provider rows to show **Live availability: not checked**, and that provider/certification status remains unproven after five handover saves. Verify these assertions at the final committed SHA before integration.

## What is still required

M3.12.02 is **NOT FULLY VERIFIED**: actual protected-stage monitoring/alerts, on-call support and production rollback/incident drills remain unverified.
M3.12.03 is **NOT FULLY VERIFIED**: real email/SMS/payment/liveness/video scanning/storage provider availability, delivery and operations remain external blockers.
M3.12.04 realistic managed PostgreSQL/object-store RPO/RTO and live restoring active cases are still open, despite the scoped disposable PG16 restore tests from PR #63.
All 218 scenarios, full all-role pentest and Owner UAT remain open. Do not make GO claims based on this UI change or local test.

**NEXT:** Run full browser + native checks on the exact committed SHA, verify GitHub CI and merge the guarded PR into the active QA branch if green, then resume executable alert/rollback and real provider gates. Protect other worktrees.
