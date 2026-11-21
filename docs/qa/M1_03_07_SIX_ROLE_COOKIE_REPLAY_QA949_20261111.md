# M1.03.07 — six-portal Exit/Cancel/Sign Out and copied-cookie replay (SCOPED, NOT FULL)

**Source:** signed QA merge commit `949fdefdbac15feefc342275a3e3738917ef307c` (PR #82, **19/19 merged-SHA GitHub Actions PASS**). Isolated clean source branch `qa/verify-m10307-session-replay-20261111`. V4 session `4b8b307b-65bd-4739-828d-c98023be86af`. Local test started uncommitted; PR and merged exact-SHA CI must be checked separately.

**Verdict: scoped regression GREEN, M1.03.07 still NOT FULLY VERIFIED.** Frozen ledger last inspected `218 total, 0 FULLY_VERIFIED, 1 IN_PROGRESS, 10 BLOCKED_EXTERNAL_KNOWN, 207 NOT_STARTED`. **RELEASE NO-GO.** Local synthetic Chromium/Next/PGlite environment is not final staging with real providers or complete authorized penetration testing.

## Actual user and attacker-controlled synthetic browser checks

- New `node --test tests/browser/six-role-session-cookie-replay.browser.test.mjs`: **1/1 PASS, exit 0**. Six real roles (Worker, Company, Assessor, Verifier, Admin, Root) at independent **320px/390px** Chromium contexts. After role-valid login, capture the **opaque HttpOnly session cookie** but never print it. An independent copied-cookie context gains exactly the same valid role while a direct different-portal role URL is denied.
- Real UI **Exit Portal** navigation leaves the owner and copied cookie working. UI **Sign Out → Cancel** likewise leaves both valid. On **Sign Out → confirm**, the original tab, already-open copied-cookie browser, and a **new context injecting the previously captured token** all fail the protected role dashboard; copied stale session cannot access `/account/sessions`. Database persisted **exactly one session row per role, revoked with `user_logout`**, one immutable logout event and at least one `role_mismatch` access-denial audit per role. Raw evidence `.autopilot/artifacts/M10307_REAL_CHROMIUM_COPIED_COOKIE_GREEN.log`.
- Existing `node --test --test-concurrency=1 tests/browser/active-session-boundaries.browser.test.mjs tests/browser/authentication-boundaries-e2e.browser.test.mjs`: **2/2 PASS, exit 0** after new test. Six roles' foreign-account session ID/form tampering fails, own other-session revoke works, current session Sign Out works, cross-portal and wrong-password/MFA denials, Exit preserves session, authoritative DB/audit persist. Raw `.autopilot/artifacts/M10307_BROWSER_ACTIVE_AND_EXIT_GREEN.log`.
- `node --test tests/platform/authorization-session-context.test.mjs tests/platform/authentication-signed-out-proxy.test.mjs`: **6/6 PASS, exit 0**. Native session context derives authority from server session cookie/database; revoked/expired/inactive sessions preserve status for central denial. These source/native checks do not constitute live HTTP or production provider penetration testing. Raw `.autopilot/artifacts/M10307_NATIVE_SESSION_AUTHORITY_GREEN.log`.

## Baseline gap and limitations

- Previously signed QA already tested role-specific sign-out and owned-session revocation, but did not have a dedicated **independent copied-cookie replay across fresh browser contexts** on all six roles. This is a test-coverage gap, **not a demonstrated product vulnerability**. The newly added test did not require a product implementation change.
- **Still missing for FULL verification**: actual HTTPS/SameSite/Secure cookie transport, Origin/CSRF POST tampering, adverse provider and network interruption/outage, concurrent session race/expiry, realistic load and restore, full role/API/tenant abuse against final controlled staging, real external providers and Owner UAT. No scenario accepted as FULLY_VERIFIED.
- New exact-SHA two-job CI workflow `.github/workflows/m1-03-six-role-session-replay.yml` runs 3 real Chromium browser suites (new copied-cookie + existing current/other sessions and six-role login) and 6 native cases, stores head-SHA logs. Need GitHub exact-head + merge-SHA CI signoff.

## Handoff

1. Confirm new browser test and workflow syntax, run lint and TypeScript, update resume and evidence ledger **as scoped only**, V4 audit, guarded commit of new test, workflow and QA docs on isolated branch; push and PR against `qa/a28-eligibility-read-guard-20261107`.
2. Wait for GitHub exact head-SHA workflow and Autopilot compliance **PASS**; if green, signed two-parent merge, then independently verify all merged-SHA workflows. Never merge on CI red.
3. Continue the **first uncovered actionable** M1.03.07 direct synthetic HTTP-origin/session-replay/race or M1.03.08 password changes; if external credential/provider blocked, mark `BLOCKED_EXTERNAL` and advance. Protect other worktrees/running tests. Do **not** promote any of the 218 based on scoped local results.
