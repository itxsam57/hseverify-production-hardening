# M1.01.01 — exact QA source runtime/startup/security drill (2026-11-10)

**Result: SCOPED LOCAL PASS, NOT FULLY VERIFIED.** This is not a protected staging release signoff.
Exact tested code SHA: `497a06cd174d02c634291e6f5524e9f85074956b` (merged PR #68). Active QA branch: `qa/a28-eligibility-read-guard-20261107`.
Isolated worktree: `hseverify-m101-runtime-20261110`; branch `qa/verify-m101-runtime-20261110`. Synthetic test users/isolated PGlite databases only.

## Actual actions and verified evidence

| Test group | Exact command | Result |
| --- | --- | --- |
| Production-mode environment rejection | `node --test tests/platform/production-environment-isolation.test.mjs` | **11/11 PASS**: production refuses demo auth/data, sandbox, PGlite, missing DB URL, missing/short secrets/pepper and missing release identity |
| Next output/isolation | `npm run test:next-system` | **4/4 PASS**: no tracked generated artifacts; source configs unaffected |
| Actual local startup | `npm run test:development` | **PASS**, real loopback HTTP 200, process shut down cleanly |
| All six signed-out portals | `npm run test:portal-redirects` | **PASS**, real HTTP 307 on eleven protected endpoints, role login pages 200 |
| Migrated existing worker profile survives runtime | `npm run test:runtime-db` | **PASS**, actual persisted PGlite worker data preserved across local Next startup, no source config changes |
| Real Chromium headers and secrecy | `node --test tests/browser/security-response-headers.browser.test.mjs` | **1/1 PASS**, CSP/HSTS/frame/content/referrer policies, no auth pepper/session secret leaked in HTML |
| Actual six-role Chromium login and authorization | `npm run test:authentication-boundaries-browser` | **1/1 PASS**, Worker, Company, Assessor, Verifier, Admin, Root wrong-role and wrong-password denials, staff MFA negatives, Exit Portal vs Sign Out, cross-role forbidden routes |

**Total: 7/7 isolated command groups exit 0; 17/17 explicit native/Chromium tests plus three real HTTP smoke groups.** Group results: `.autopilot/artifacts/M101_EXACT_497a_RESULTS.tsv` and `M101_EXACT_497a_BROWSER_RESULTS.tsv`; full per-group `.log` files. No running Next/test process remained.

### Expected negative runtime gate

With an intentionally empty controlled *production* environment (no secrets/DB connection), `env -i ... NODE_ENV=production HSE_APP_ENV=production HSE_DATABASE_DRIVER=postgres node scripts/validate-environment.mjs` correctly exited **1**, rejecting missing session/signing/auth secrets, PostgreSQL URL and release SHA. Log: `.autopilot/artifacts/M101_MISSING_PROD_ENV_EXPECTED_DENIAL.log`. This is **correct rejection**, not a product defect or proof that real production is misconfigured.

## Remaining acceptance and next work

- **M1.01.01 NOT_FULLY_VERIFIED:** protected, deployable exact SHA staging startup/health; real configured PostgreSQL and all pending migrations; live provider and secrets integration, production domain TLS/CSP/HSTS on deployed hostname; owner review of actual stage config; authenticated full six-role security and all relevant retries/failure/recovery on final candidate.
- These tests used development-mode synthetic configuration, not a protected deployment with real providers. No provider activation, incident drill or Owner UAT was performed. Full 218 release ledger remains **0/218, NO-GO**.
- **NEXT FIRST:** verify M1.01.02 exact SHA migration/rollback invariants in a disposable real PostgreSQL instance; record any red, then full protected stage and provider work if credentials become available. Do not conflate local tests with fully verified scenarios.

This is a scoped historical test receipt bound to SHA `497a06cd174d02c634291e6f5524e9f85074956b`; subsequent docs commits do not retroactively change the tested SHA.
