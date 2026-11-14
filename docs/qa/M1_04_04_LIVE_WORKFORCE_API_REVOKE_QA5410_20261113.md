# M1.04.04 — live Company staff workforce export stale-permission/revocation browser proof (SCOPED, NOT FULL)

Date: 2026-11-13 Asia/Karachi. **Exact signed QA base** `5410bcf8397f1c596adf787e2fbdcdfc93e108aa` (PR #91 GitHub-verified two-parent merge, **26/26 merged-SHA workflows PASS**). Isolated worktree `hseverify-m10404-stale-role-20261113`, branch `qa/verify-m10404-stale-role-20261113`. V4 cycle `63d759de326c4ddd8be47153534e0219`, audit session `0874f8bf-0fc7-4c0f-85f2-b9d932fe01a8`.

**FULLY VERIFIED 0/218 | PENTEST INCOMPLETE | ≥10 known BLOCKED_EXTERNAL | RELEASE NO-GO.** No production code change. Only added real browser assertions, exact-commit CI, scoped evidence.

## Missing coverage / RED (not a product exploit)
At base SHA, `rg -n ACTUAL_COMPANY_STAFF_EXPORT_API_LIVE_REVOKE tests/browser/company-complete-journey.browser.test.mjs` expected exit 1. Existing real browser tests covered member page denial after suspension/revoke and Company staff role ceiling, but did **not** assert `GET /api/company/workers/export` for the same signed-in staff member across live permission transitions. Coverage-only RED log `.autopilot/artifacts/M10404_STAFF_EXPORT_API_LIVE_REVOKE_COVERAGE_RED_20261113.log`.

## Actual Chromium positive/negative/role abuse and persistence
`node --test --test-concurrency=1 tests/browser/company-complete-journey.browser.test.mjs`: **1/1 PASS, exit0, 128.8s**. Original full Company owner+Worker+independent Company staff (MFA login) journey and DB/audit retained.

- Actual Company owner Team UI grants an already signed-in independent member the `company.workforce.manage` permission. Member's authenticated direct HTTP `GET /api/company/workers/export` returns **200** real CSV header in the correct existing session.
- Owner removes the permission through the Team UI, with no member logout or new login. Direct existing member session is **denied**, no CSV data; forged `x-hse-active-role:root`, `x-hse-account-id` and `x-hse-tenant-id` are also **denied**, with no CSV content.
- Owner regrants the permission using the UI. **Same existing member session** obtains **200 CSV** again, without new login or new cookie.
- Owner suspends and later revokes the member through actual UI. Both conditions deny the direct CSV endpoint using that still existing signed-in member request context, with no CSV returned; existing browser page access-denied assertions retained.
- Authoritative PGlite verified member membership `revoked`, session still persisted unrevoked (proving live membership authorization, not just cookie deletion), and all Company security denial events bound to original session and mirrored in immutable audit. Existing separate Company workforce/assurance/billing/receipt assertions remain PASS. No confirmed product vulnerability.
- Raw actual Chromium: `.autopilot/artifacts/M10404_COMPANY_JOURNEY_LIVE_EXPORT_CHROMIUM_20261113.log`.

Adjacent `node --test --test-concurrency=1` 4 native authorization/tenant test files: **9/9 PASS**, `.autopilot/artifacts/M10404_NATIVE_20261113.log`. Strict `npm run typecheck` PASS; `npm run lint` exit0 (**0 errors / 9 inherited warnings**); JavaScript and YAML syntax + `git diff --check` PASS. Logs `.autopilot/artifacts/M10404_{TYPECHECK,LINT}_20261113.log`.

## Exact-SHA GitHub CI + remaining FULL acceptance
Added `.github/workflows/m1-04-staff-live-export-revocation.yml`: real x86 Chromium full Company journey with required marker and fail-on-red annotated logs; independent native session/member permission regression; exact PR/push SHA pinned with retained artifacts. **Pending GitHub PR exact head / merged-SHA runs until executed; not yet PASS.**

Required for full M1.04.04: every role and tenant/API action, stale and replayed authorization across all workflows, expiry, concurrency/races/retries, full protected production-like staging exact-SHA and real provider gates, realistic load/restore and owner UAT. Do not promote the frozen 218 ledger.

**NEXT:** guarded commit/push this focused test+CI+report+TSV+handoff; observe exact-head GitHub real Chromium/native/Autopilot CI; fix first RED if any. Do not merge before exact-head all PASS; signed two-parent merge then full merged-SHA CI if cleared. PR #90 Company report export separately still queued runner with earlier failed browser assertion unretrievable; preserve it and other worktrees. **NO-GO.**
