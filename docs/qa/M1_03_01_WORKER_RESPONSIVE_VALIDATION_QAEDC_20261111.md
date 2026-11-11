# M1.03.01 — Worker registration invalid fields, terms, privacy and password confirmation (SCOPED QA)

**Date:** 2026-11-11 Asia/Karachi. **Signed QA source SHA:** `edc0db1dd847d7e2e7e1dd7086bf18fbee3f34a3` (PR #84 signed two-parent merge; **21/21 exact merged-SHA GitHub CI runs SUCCESS**). Isolated authorized worktree `/home/ubuntu/work/hseverify-m10301-worker-validation-20261111`, branch `qa/verify-m10301-worker-validation-20261111`. V4 audit session `8f15ee87-3bae-4240-b644-9c066eeecc1a`, cycle `1360c764e9cd431b9ccf5f9f616ec45a`.

**Verdict: local software checks PASS, but M1.03.01 remains NOT_FULLY_VERIFIED. Release NO-GO, frozen FULLY VERIFIED 0/218.** Real provider email/SMS, complete API pentesting, final staging, interruption/retry/race/load/restore and owner UAT are NOT signed off.

## Baseline coverage-only red

Existing `tests/browser/worker-registration-policy-e2e.browser.test.mjs` already covers real Worker invalid fields, missing terms/privacy/country, password mismatch, hydrations disabled before readiness, acceptedAt tampering and persistence. It did **not** assert actual responsive width/button usability at **320px and 390px** through invalid, corrected and submitted states. The signed QA HEAD command `git grep -n M10301_MOBILE_VALIDATION_320_390 HEAD -- tests/browser/worker-registration-policy-e2e.browser.test.mjs` exited 1 (absent test marker). **This was a test-coverage gap, not an application vulnerability.** Raw `.autopilot/artifacts/M10301_WORKER_MOBILE_BASELINE_COVERAGE_RED_20261111.log`.

## Real browser, API-triggering UI and authoritative DB

- `node --test tests/browser/worker-registration-policy-e2e.browser.test.mjs`: **1/1 PASS, exit 0**, real Chromium, single source/test changes. Existing real form actions: the 6 fields, company code, terms/privacy and Create Worker account are disabled until scripts/hydration ready; missing fields/terms/privacy/country and invalid name/email/phone/password strength/confirmation mismatch expose role-specific validation errors; preserving valid fields on retry; valid country/terms/privacy and account creation navigate to OTP verification.
- **New actual responsive checks:** 320px initial hydrated form `scrollWidth=320`, 320px invalid terms/privacy/password/country `scrollWidth=320`, **390px mismatched-password state `scrollWidth=390`**, 320px corrected/complete form `scrollWidth=320` and 320px pending email verification screen `scrollWidth=320`. The Create Worker account button was at least 44px tall and not clipped at each registration state. No source product/CSS changes needed.
- Backend reads: exactly one intended account and pending registration flow, no additional signup records from prior invalid submissions, one hashed registration email OTP challenge, server-dated immutable policy acceptance despite forged future `acceptedAt`, cancellation and audit persistence. No browser JS error. Evidence `.autopilot/artifacts/M10301_MOBILE_POLICY_CHROMIUM_GREEN_20261111.log`.
- Native `node --test tests/platform/worker-registration-policy-runtime.test.mjs`: **3/3 PASS**, missing country/acceptance fail before creating account/flow/OTP, accepted policy history immutable on pending and canceled, failed policy audit persistence transaction rolls back account/flow/OTP. Evidence `.autopilot/artifacts/M10301_POLICY_NATIVE3_GREEN_20261111.log`.

## Engineering quality and CI

New two-job GitHub Actions workflow `.github/workflows/m1-03-worker-registration-policy-responsive.yml` runs **actual Chromium Worker 320/390 + native 3 cases on exact PR/merged SHA**, retains logs as artifacts. Local JavaScript syntax, YAML parse and `git diff --check` should be run before guarded commit. **PR and merged-SHA CI pending** when this report was created.

- `npm run typecheck` **PASS** strict TS + isolated Next route types. `npm run lint` **exit 0** with zero errors and 9 inherited unrelated warnings. `node --check` test JS, local YAML two-job parse and `git diff --check` PASS. Raw `.autopilot/artifacts/M10301_TYPECHECK_GREEN_20261111.log`, `.autopilot/artifacts/M10301_LINT_EXIT0_WARN9_20261111.log`.

## Strict remaining gates

M1.03.01 is **NOT FULLY VERIFIED**: real production email/SMS OTP provider behavior belongs to M1.03.02 and remains BLOCKED_EXTERNAL; this scenario also lacks comprehensive Origin/CSRF/form-action tamper, concurrent duplicate request/race and interruption/retry, real receiving-role notification/audit on final candidate, exact stage responsive and keyboard/accessibility matrix, production-grade HTTPS, load/restore and owner UAT. No acceptance promotion.

## Next commands

1. Run strict TypeScript, ESLint, JS syntax, YAML parser, guarded V4 checkpoint; commit/push ONLY new Worker responsive test extension, exact-SHA CI, report/TSV/resume/audit within this isolated worktree.
2. Open PR against `qa/a28-eligibility-read-guard-20261107`; require new real-browser/native jobs and Autopilot compliance and all triggered checks green on candidate SHA, signed two-parent merge, then merged-SHA CI sign-off.
3. Continue first unfinished Worker registration direct server-action Origin/CSRF and double-submit race; if external providers block, mark `BLOCKED_EXTERNAL` and advance. Protect concurrent worktrees/processes and keep release **NO-GO**.
