# M1.04.02 — Company workforce CSV export, forged tenant filters and revoked-permission isolation (SCOPED ONLY)

Date: 2026-11-12 (Asia/Karachi). **Signed QA base:** `3f80ccbc485cdcf83a7ae017f794e5da05a64a71` (PR #88 two-parent verified GitHub merge; **24/24 exact merged-SHA workflows PASS**). Isolated `hseverify-m10402-workforce-csv-20261112`; branch `qa/verify-m10402-workforce-csv-20261112`; V4 audit session `0333926f-91b2-460f-897b-9f01f2d9d7c8`; cycle `b60430cfded2458c8b5109af54c83a4c`. Other worktrees untouched.

**FULLY VERIFIED 0/218 | M1.04.02 NOT_FULLY_VERIFIED | PENTEST INCOMPLETE | ≥10 known BLOCKED_EXTERNAL | RELEASE NO-GO.** Local actual Chromium/Next/PGlite fixture only, no production provider or final protected staged SHA.

## Missing baseline regression (coverage-only RED)

The existing `tests/browser/company-workforce-pagination.browser.test.mjs` already verified 1440px, 390px and 320px UI workforce search, keyboard controls, paginated status persistence, foreign/unlinked Worker exclusion, SQL-like search, forged `tenantId/accountId` query selectors and live revoked workforce read permissions. **It never called `GET /api/company/workers/export`** with the same filters, forged headers or revoked permission. This was missing test coverage, **not** an observed product vulnerability. Raw `.autopilot/artifacts/M10402_WORKFORCE_CSV_BASELINE_COVERAGE_RED_20261112.log`.

## Fresh real-browser GET CSV and persisted tenant-scope behavior

Command `node --test tests/browser/company-workforce-pagination.browser.test.mjs` -> **1/1 PASS, exit 0** on local synthetic real Chromium and migrated PGlite.

- The actual Company MFA sign-in and real UI search ran at **1440, 390 and 320px**. The fixture seeded 26 active linked Workers, one revoked linked Worker and an intentionally **same-name unlinked foreign Worker** with a distinct email to catch false joins and tenant leakage.
- `GET /api/company/workers/export` with `q=Safety & Operations 25&status=active` plus attacker-controlled `tenantId`, `accountId`, `role=root` parameters and spoofed `x-hse-tenant-id`, `x-hse-account-id`, `x-hse-active-role` headers returned **HTTP 200**, `text/csv`, private no-store. Its **header + one correct linked Worker** row excluded the same-name unlinked foreign Worker and all unmatched Workers; forged identity hints did **not** alter authoritative tenant scope.
- Active-only CSV with `q=Safety & Operations` returned **exactly header + 26 active linked Workers**. The revoked linked Worker and foreign unlinked Worker were absent. Query `' OR 1=1 --` returned **header only**, with no SQL-like filter bypass.
- Anonymous direct CSV access with redirects disabled was denied safely, with no Worker email exposed.
- After the test inserted a real authoritative Company membership permission-deny override, the existing login remained on its own Company dashboard, direct workforce page was redirected to `/access-denied`, and **the CSV export returned HTTP 307** with no worker email or CSV data (no stale permission fail-open).
- Existing UI test still passed search keyboard and pagination Next/refresh/Previous, no foreign worker view. No product source changes.
- Raw `.autopilot/artifacts/M10402_WORKFORCE_CSV_FILTER_PERMISSION_CHROMIUM_GREEN_20261112.log`.

## Adjacent regressions and source quality

- `node --test tests/platform/authorization-tenant-scope-repository.test.mjs`: **3/3 PASS** — native SQL read/write tenant scoping, non-enumerating misses, lifecycle permission revalidation and reversible migration. Raw `.autopilot/artifacts/M10402_WORKFORCE_TENANT_NATIVE3_GREEN_20261112.log`.
- `npm run typecheck`: PASS strict TypeScript/Next-generated routes. `npm run lint`: exit0 **0 errors/9 inherited warnings**; browser JS `node --check`, new two-job GitHub YAML parse and `git diff --check` PASS. Raw `.autopilot/artifacts/M10402_WORKFORCE_{TYPECHECK_GREEN,LINT_EXIT0_WARN9}_20261112.log`.
- New exact-head/merged SHA two-job GitHub workflow `.github/workflows/m1-04-company-workforce-csv-tenant-isolation.yml` requires actual x86 Chromium browser and native tenant tests, archived logs. **PR CI is pending at report creation.**

## Strict unverified gates and next

This is only one CSV/filters boundary. Other Company/Worker exports, cross-role recipients/notifications, API object ID and capability matrix, provider-backed files, final HTTPS staging, provider failures/retries/races, load/backup/restore, accessibility/UAT and 218 frozen scenario full acceptance remain outstanding. No claim that M1.04.02 or any scenario is fully verified.

Guarded isolated commit/push only test, workflow, evidence, checkpoint and audit. Demand exact PR-head Chromium/native/Autopilot CI PASS; GitHub signed two-parent merge then independent **all merged-SHA CI** green. Next close remaining M1.04.02 record/export API gaps; release stays **NO-GO**.
