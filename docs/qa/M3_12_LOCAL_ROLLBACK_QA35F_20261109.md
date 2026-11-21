# M3.12.04 — exact QA rollback build, data recovery and release blockers (2026-11-09)

**FULLY VERIFIED 0/218 | PENTEST INCOMPLETE | RELEASE NO-GO.** All successes below are scoped to disposable **local** infrastructure, not protected staging, real providers or Owner UAT.

Exact active QA code SHA: `35f40507d243b0184c308bea0d32fe0f09f747aa` (PR #66 signed merge). Branch: `qa/a28-eligibility-read-guard-20261107`. Isolated verification worktree: `hseverify-m312-rollback-drill-20261109`, branch `qa/m312-rollback-candidate-drill-20261109`. No consumer production data or external staging environment touched.

## Actionable results at this exact SHA

- **Release source:** `npm ci --no-audit --no-fund --prefer-offline` exited 0 with lockfile SHA-256 `832ed6c4c95834165d203599a2d93c6b85136148f27ba6eb81a7658240194846`.
- **Next production build:** `npm run build` exited 0, compiled real outbox worker and Next 16.4.3, verified no source configuration mutations. See `.autopilot/artifacts/M312_ROLLBACK_LOCAL_BUILD.log`.
- **Portable rollback-candidate bundle + real HTTP smoke:** `npm run preview:smoke` exited 0; all six portal login pages returned HTTP 200, worker registration/recovery returned HTTP 200, forbidden auth sandboxes 404, signed-out protected portals redirected to role logins; verified traced PGlite in copied standalone bundle and no symlink vulnerabilities. Preview server stopped. **Not a deployed release.**
- **Release manifest:** `npm run release:manifest` exited 0 and explicit assertions confirmed full exact SHA, environment `preview`, lockfile SHA-256 and 64-character migration set SHA-256. File `release-manifest.json` was produced locally; see `.autopilot/artifacts/M312_ROLLBACK_LOCAL_SMOKE_MANIFEST.log`. No production promotion occurred.
- **Real disposable PostgreSQL 16:** all **13/13** tests in nine canonical PostgreSQL suites PASS exit0, including retained report standard custom-archive restore, active Worker saved answer and next-question draft recovery, verified identity/qualification, three private file objects and digest, foreign Worker denial, cross-role/reviewer contention. PostgreSQL bound only to random loopback port, stopped and deleted after run. Receipt `.autopilot/artifacts/M312_ROLLBACK_EXACT_QA35f_PG16_SUITE.tsv` and complete `.log`.
- **Actual PR66 QA merged-SHA CI:** 5/5 GitHub Actions workflow runs on `35f40507...` are completed SUCCESS, including guarded commit provenance and M3.12 operational monitor. This is not protected final staging signoff.

## Verified blockers (do not claim full M3.12.04)

1. **GitHub rollback workflow not dispatchable:** the existing `.github/workflows/rollback-candidate.yml` is tracked at QA35f, but GitHub CLI returns `HTTP 404: workflow rollback-candidate.yml not found on the default branch`. Default branch is `qa/hse-production-hardening`. Do not silently copy/move workflow to default or fabricate an Actions run; this needs deliberate governance/registration. The existing workflow **checks/builds/uploads an artifact only** — it never promotes or rolls back live staging/production.
2. **Actual recovery objectives unproven:** no protected staging incident rollback, live managed database backup/PITR, provider object storage restore, network failover, multi-tenant RPO/RTO with active consumer workflows or human on-call acceptance.
3. **Frozen 218 ledger cannot reconcile from this clean worktree:** `npm run audit:current-218-scenarios` exited **1**, asserting `Missing actual test evidence: 20261029-A26-registration-provider-browser.log`. The historical A26 registration log exists only in the separate older hseverify-masterplan-release/.autopilot/artifacts worktree, not in this clean QA35f checkout; it refers to earlier SHA-scoped observations and is not current-candidate proof. Do **not** create empty logs, copy old logs as current proof, lower assertions to fake a pass or report historical `passed` as FULLY_VERIFIED. Original 218 unique rows/37 bricks remain unchanged; **0/218 fully verified**.

## NEXT FIRST

1. Reconcile the **missing historical artifact blocker** without weakening proof or assuming old-SHA observations qualify for final certification; establish a fresh exact-QA ledger marking genuinely unproven acceptance dimensions OPEN.
2. Resume missing release-staging requirements: real on-call receiver and pager acknowledgement (M3.12.02), approved provider delivery (M3.12.03), protected staging rollback/data restore/RPO/RTO and rollback workflow registration (M3.12.04), all role/UI/API security matrices and Owner UAT.
3. Keep this QA worktree isolated; commit/push real evidence only via Autopilot V4 with exact SHA, test logs and blockers. Never mark the full scenario PASS on these local tests.
