# M1.03.06 — six-portal responsive login and authorization boundary (SCOPED, NOT FULL)

Date 2026-11-11 Asia/Karachi. **Source signed QA SHA:** `0d5823c744a5edfb209a738ea18f909c40925214` (PR #81 merged, signed, 19/19 merged-SHA workflows SUCCESS). **Isolated QA worktree:** `/home/ubuntu/work/hseverify-m10306-six-role-login-20261111`, branch `qa/verify-m10306-six-role-login-20261111`; V4 governed audit session `7909c896-f382-424c-8573-057b4e909f03`.

**Release verdict remains NO-GO, FULLY VERIFIED 0/218. M1.03.06 is NOT FULLY VERIFIED.** Evidence is synthetic local Playwright Chromium/Next/PGlite against signed QA source plus uncommitted test/CI additions at first execution; not final exact-SHA staged acceptance or genuine external provider checks.

## Baseline coverage gap and corrected test harness (NOT application vulnerabilities)

- Signed QA commit already had `tests/browser/authentication-boundaries-e2e.browser.test.mjs` covering six-role desktop invalid credentials, cross-portal URLs, Exit vs Sign out and authoritative DB. It lacked a dedicated actual **320px/390px** full six-role form/negative/MFA/login/DB matrix. Source-coverage RED `git grep -n 'M1.03.06 all-six mobile 320/390 role login' HEAD -- tests/browser/six-role-mobile-auth-boundaries.browser.test.mjs` returned 1 (missing test). Evidence `.autopilot/artifacts/M10306_MOBILE_COVERAGE_BASELINE_RED_20261111.log`; this is a *test gap*, not an exploited defect.
- The first new test runner's Worker logout step clicked the entry button but omitted the existing **Confirm Sign out** dialog. It timed out after the dialog opened. Corrected the test sequence to click the dialog's own `Sign out` button. **No product fix** was needed, and no application bug claimed.

## Fresh actual browser and native verification

- `node --test tests/browser/six-role-mobile-auth-boundaries.browser.test.mjs` — **1/1 PASS, exit 0**, one complete test covering *Worker, Company, Assessor, Verifier, Admin and Root* at both **320px and 390px**. Each viewport navigates from no-session dashboard to the correct role-specific login; browser confirms visible "Sign in to continue" state, zero horizontal overflow, 44px+ Sign in button; invalid password and privileged-role incorrect MFA denied without sessions; valid credentials for a different portal rejected; successful 390px sign-in, then direct foreign portal URL denied; real modal-confirmed Sign out then direct dashboard denied. PGlite DB verifies **one owned session per role, each revoked `user_logout`**, persisted `login_failed`, `mfa_failed` for privileged roles, `role_mismatch` access-denied events. No browser JS errors/HTTP500 responses. Raw local result: `.autopilot/artifacts/M10306_SIX_ROLE_MOBILE_ACTUAL_CHROMIUM_GREEN_20261111.log`.
- `node --test tests/platform/authentication-portal-isolation.test.mjs tests/platform/authentication-signed-out-proxy.test.mjs` — **12/12 PASS, exit 0** source/native checks of role-fixed actions, session/audit ordering, privileged-role boundary, server proxy without DB access. **These source checks are not live HTTP penetration testing**. Raw `.autopilot/artifacts/M10306_SIX_ROLE_NATIVE12_20261111.log`.
- `npm run typecheck` — **PASS** strict TypeScript and isolated Next route types, raw `.autopilot/artifacts/M10306_TYPECHECK_GREEN_20261111.log`.
- `npm run lint` — **exit 0** with **0 errors, 9 pre-existing unrelated unused symbol warnings**, raw `.autopilot/artifacts/M10306_LINT_EXIT0_WARN9_20261111.log`.
- `node --test tests/browser/authentication-boundaries-e2e.browser.test.mjs` — **fresh same QA0d5823 worktree 1/1 PASS**, actual six-role desktop login wrong password/MFA, 30 cross-role login denials, 30 direct portal URL denials, Exit Portal session preservation vs Sign Out revocation, immutable persisted DB audit. Raw `.autopilot/artifacts/M10306_SIX_ROLE_DESKTOP_CHROMIUM_GREEN_20261111.log`. Still not final staging.
- New two-job workflow `.github/workflows/m1-03-six-role-login-responsive.yml` requires exact PR-head SHA and merged-QA SHA: desktop+mobile real Chromium tests, 12 native checks; artifact preservation. **GitHub PR CI not yet run** as of initial documentation.

## Remaining penetration and release requirements

- Real provider OTP/MFA delivery and recovery paths, session cookies under production HTTPS/CSRF/origin tampering, full endpoint/role/tenant BOLA and UI matrix, session expiry/race/concurrent-requests, replay with copied cookies, realistic load/restore, protected final staged deployment, monitoring, owner UAT, and all 218 final candidate scenarios. No full scenario claim.
- Stage remains **NO-GO**; at least 10 known external blockers from frozen ledger. Existing ledger is dated earlier candidate SHA; it must be reconciled on the final exact release candidate, **do not promote** `M1.03.06` based on scoped test evidence.

## Handoff / next exact steps

1. Confirm fresh desktop test result (exit 0 expected but not preclaimed). Validate YAML, diff, TS/lint; checkpoint V4 `test-red` (coverage-only) then `verifying`.
2. Guarded commit only the isolated new real browser test, 2-job exact-SHA GitHub workflow, this report, evidence TSV, current resume and audit chain. Push `qa/verify-m10306-six-role-login-20261111` and open PR to `qa/a28-eligibility-read-guard-20261107`. Demand new Chromium+native jobs, Autopilot compliance and any triggered checks on exact PR SHA, signed two-parent GitHub merge and merged-SHA replay.
3. Next unfinished actionable test: broader M1.03.06 direct HTTP server-action CSRF/Origin/role/tenant abuse or M1.03.07 session-exit/revoke/interruption in actual browser; label true external provider/staging gaps BLOCKED_EXTERNAL and advance when necessary.