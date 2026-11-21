# M1.03.04 — Company email OTP to MFA activation and cross-role boundary (SCOPED, NOT FULL)

**Date:** 2026-11-11 (Asia/Karachi). **Source QA baseline:** `141aae46b6517033db8fa8efa45cc809e2a74b44` (merged PR #78). **Isolated worktree/branch:** `hseverify-m10304-company-activation-20261111` / `qa/verify-m10304-company-activation-20261111`. Tests below were run against this source plus the isolated uncommitted M1.03.04 test changes; **the final committed SHA, PR CI and staging acceptance are not yet demonstrated by this log**.

## Reproduced test-coverage gaps (NOT product exploits)
- QA141 baseline Chromium registration suite did not attempt *correct* authenticator login **before enrollment**, and did not attempt Worker login using a valid Company account. Source-coverage RED recorded under `.autopilot/artifacts/M10304_PREACTIVATION_WRONGROLE_COVERAGE_RED.log`. No runtime vulnerability established.
- QA141 native Company registration suite had no simultaneous MFA verification regression. `git grep -n 'six simultaneous Company MFA activation requests' HEAD -- tests/platform/company-registration-otp-runtime.test.mjs` returned 1 (expected no match); exact command in `.autopilot/artifacts/M10304_BASELINE_CONCURRENCY_COVERAGE_RED_20261111.log`.

## Fresh scoped results
- `npm run test:company-registration-otp` — **exit 0, 9/9** native cases, including newly added **six parallel in-process MFA submissions** in isolated PGlite. All six returned completed flow; authoritative persisted flow complete, Company owner membership and MFA factor active, tenant still pending; **exactly one** `mfa_enrolled` security event and audit entry; **zero sessions** before explicit login. Existing OTP exhaustion, resend/expiry, invalid MFA and audit-failure rollback cases remain passing. Raw: `.autopilot/artifacts/M10304_FRESH_NATIVE9_QA141.log`.
- `node --test tests/browser/company-registration-boundaries.browser.test.mjs` — **exit 0, 1/1** real Chromium full Company registration case. Wrong email OTP/exhaustion; correct live TOTP preactivation login denied on 320px; invalid MFA denied/audited; completed activation and correct Company sign-in; Company session denied on Worker dashboard and independent Worker sign-in with Company credentials denied/audited at 390px; persisted single Company role/session, pending tenant, active owner, active MFA factor, completed flow. Raw: `.autopilot/artifacts/M10304_FRESH_BROWSER_QA141.log`.
- `npm run typecheck` — **exit 0**, strict TypeScript and generated route types verified; raw `.autopilot/artifacts/M10304_FRESH_TYPECHECK_QA141.log`.
- `npm run lint` — **exit 0**, **0 errors / 9 pre-existing unused-symbol warnings** (unrelated files); raw `.autopilot/artifacts/M10304_FRESH_LINT_QA141.log`. (Add exact committed CI evidence separately after push.)
- `git diff --check` — **exit 0**; `python3 .autopilot/autopilot_state.py validate` — **valid=true**. GitHub workflow YAML parsed locally with PyYAML; **remote workflow has NOT run as of this entry**.

## Limits and release blockers
- Six in-process PGlite calls **do not prove independent PostgreSQL connection/row-lock contention** or realistic infrastructure load. Repeat on isolated disposable real PostgreSQL with independent connections and duplicate/replay/expiry, then final staging.
- Real external email/SMS, CSP/CSRF comprehensive attack coverage, all six receiving roles, cross-tenant authorization matrix, outage/retry, complete 218 evidence, full pen test, staging exact-SHA, load/restore, protected branch and Owner UAT remain unverified.
- M1.03.04 stays **NOT FULLY VERIFIED**; frozen 218 ledger still **0/218 FULLY_VERIFIED**. **RELEASE NO-GO**.

## Handoff
1. ESLint/typecheck/native/Chromium scoped results are green. Record signed exact committed SHA, then demand CI replay on that SHA.
2. Check guarded V4 audit receipt; checkpoint test-red (coverage gap) followed by verification; sign guarded commit of these two test files, this report, TSV, new isolated GitHub Actions workflow and audit chain. Do not stage unrelated worktrees.
3. Push `qa/verify-m10304-company-activation-20261111`, open PR into `qa/a28-eligibility-read-guard-20261107`, require exact commit workflow (real browser, 9 native, compliance) and QA merged-SHA rerun.
4. Continue first feasible M1.03.04 actual PostgreSQL race and endpoint origin/tenant abuse, then M1.03.05 staff invitation lifecycle. Do not convert scoped evidence into 1/218.