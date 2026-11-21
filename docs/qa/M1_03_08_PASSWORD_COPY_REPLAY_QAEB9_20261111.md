# M1.03.08 — Six-role password change, remote-session replay and notification persistence (SCOPED, NOT FULL)

Date: 2026-11-11 Asia/Karachi. **Source:** signed merged QA SHA `eb9e5ca7b01920f1023df99af0f755c643ccdbd1` (PR #83, 20/20 merged-SHA GitHub workflows SUCCESS). Isolated worktree `/home/ubuntu/work/hseverify-m10308-password-sessions-20261111`, branch `qa/verify-m10308-password-sessions-20261111`, audit session `7085bd66-7668-48a4-a498-5d5c25ff7464`.

**Verdict: scoped engineering regression GREEN; frozen scenario M1.03.08 NOT FULLY_VERIFIED, release NO-GO and FULLY VERIFIED 0/218.** Source and tests used synthetic local Next.js/real Chromium/PGlite, not the actual final stage or live external providers. A passing subset or old SHA is NOT final release acceptance.

## Baseline coverage-only gap

Existing `tests/browser/password-change-boundaries.browser.test.mjs` already verifies real six-role bad current password/MFA, password change, one current session retained, other revoked, old password denied, new password login, immutable audit and six-role notification deep links. However it did **not** explicitly re-inject a previously captured opaque HttpOnly session token *after* password rotation in another fresh browser context. `git grep -n M10308_STALE_PASSWORD_SESSION_REPLAY_DENIED HEAD -- tests/browser/password-change-boundaries.browser.test.mjs` returned code 1 before the extension. This is **a missing regression check**, not a demonstrated product vulnerability. Raw `.autopilot/artifacts/M10308_PASSWORD_COOKIE_REPLAY_BASELINE_RED_20261111.log`.

## Fresh actual browser and security results

- `node --test tests/browser/password-change-boundaries.browser.test.mjs` **1/1 PASS, exit 0** after targeted test-only changes; full six roles Worker, Company, Assessor, Verifier, Admin, Root.
- Each role's password-change UI was actually rendered at **390px viewport with exactly 390px document width, zero overflowing elements**; alternate session context and copied-cookie replay were at 320px. No production app-code change.
- Actual wrong current password and privileged wrong authenticator code produced role-specific errors. A valid successful password change kept the initiating session and revoked the other existing session. The old password was rejected; new password authenticated and opened the correct role dashboard.
- The other session's previously captured **HttpOnly `hse_session` cookie** was re-injected in a brand-new 320px Chromium context *after* password change; access to both the protected dashboard and `/account/security` was refused on all six roles. No cookie value logged or exposed.
- Authoritative DB verified exact three role-bound sessions per account (original current active, other session `password_changed` revoked, new session active); one immutable `password_changed` security and platform audit per role. Browser notification action and DB verified exactly targeted role-specific recipient, unread/read persistence, authenticated deep link and success jobs.
- Raw evidence `.autopilot/artifacts/M10308_SIX_ROLE_PASSWORD_COPY_REPLAY_GREEN_20261111.log`.

## Additional native rollback and recipient scope

- `node --test --test-concurrency=1 tests/platform/account-security-business-rollback.test.mjs tests/platform/account-security-audit-runtime.test.mjs tests/platform/account-security-notification-runtime.test.mjs`: **10/10 PASS, exit 0**.
- Includes retained immutable audit mappings, rollback if audit destination or notification job queue fails (no partial password/session mutation), account security notification idempotency, six-role recipients (including pending Company boundaries), forged/foreign metadata denial, and recoverable notification worker outages. Native PGlite, not production provider. Raw `.autopilot/artifacts/M10308_NATIVE_PASSWORD_ROLLBACK10_GREEN_20261111.log`.
- New exact-SHA two-job GitHub Actions workflow `.github/workflows/m1-03-password-change-session-replay.yml` to run real six-role Chromium and 10 native checks on PR head and subsequent merged QA SHA. **CI not yet executed at report creation.**

- `npm run typecheck` **PASS** (strict TypeScript and isolated Next route types). `npm run lint` **exit 0**, zero errors and **9 pre-existing unrelated warnings**. New browser test passed `node --check`, two-job exact-SHA GitHub workflow parsed as valid YAML, `git diff --check` passed. Raw local logs `.autopilot/artifacts/M10308_TYPECHECK_GREEN_20261111.log` and `.autopilot/artifacts/M10308_LINT_EXIT0_WARN9_20261111.log`.

## Remaining acceptance and security blockers

No complete direct HTTP Origin/CSRF/server-action pentest, concurrent password changes and session-race control, production HTTPS cookie behavior, real email/SMS notification delivery, live provider failure handling, actual final stage, realistic load/restore, full 218 release ledger reconciliation or owner UAT. **Do not count M1.03.08 as FULLY VERIFIED.**

## Next exact handoff

1. Validate new test/workflow syntax, strict TypeScript and lint; record all exact commands, SHA, pass/fail and 9 inherited lint warnings in V4 audit.
2. Guarded commit and push only changed six-role browser test, new exact-SHA CI workflow, report, TSV, current resume and audit on isolated branch. Create PR to `qa/a28-eligibility-read-guard-20261107`, require real Chromium and native plus Autopilot compliance exact candidate SHA PASS, signed two-parent merge, then check all merged-SHA workflows and notes.
3. Resume first unfinished M1.03.08 direct API/Origin/replay/concurrent tests, or advance next frozen actionable scenario. Keep external provider requirements `BLOCKED_EXTERNAL`. Protect other running worktrees. Release stays NO-GO.
