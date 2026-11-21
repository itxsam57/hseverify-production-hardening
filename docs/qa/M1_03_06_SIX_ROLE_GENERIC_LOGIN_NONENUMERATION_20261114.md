# M1.03.06 — all six role portals use identical generic authentication failure messages

**Scoped real-browser negative/security PASS; NOT FULLY VERIFIED; RELEASE NO-GO.** Initial signed canonical QA parent `e00185699a9c813984d91a754e2b0d4dbf8db058` (PR110 31/31 exact merged-SHA GitHub CI PASS). Frozen Masterplan scenario M1.03.06 is *Every portal: wrong role, wrong password/MFA and signed-out redirect*.

## Reused old tests, exact missing gap

Original prior index has **10 directly linked exact-green cases**, including real `tests/browser/six-role-mobile-auth-boundaries.browser.test.mjs` for Worker, Company, Assessor, Verifier, Admin and Root at 320/390; it already rejected wrong password/MFA/role, signed-out redirects, cross-role protected URLs, original role login and signout, and checked real DB revocation and authorization/security event logs. Native fixed portal route/role and session/audit tests were also already green. These tests are reused, never counted again.

The missing source assertion was **message equivalence**: earlier browser tests waited for any alert but never compared wrong password vs wrong MFA vs wrong-role vs unknown-email. That can expose valid accounts or assigned roles through inconsistent user-visible responses. Recorded source-coverage RED `.autopilot/artifacts/M10306_ENUMERATION_SOURCE_GAP_RED.log`; not a proven product vulnerability.

## What was actually tested

The SAME original six-role real Chromium source test now retrieves the actual visible accessible alert text and requires it equal the single generic string `The email, password or verification code is incorrect.` for **all 6 portal roles at both 320px and 390px** when using a known account with wrong password, another role's otherwise-valid account and password, and a nonexistent account with a password; the five MFA-required roles additionally use the correct known password but an incorrect authenticator code. It still checks no resulting session, no protected dashboard access, real successful sign-in at 390px, cross-role URL access denied, correct signout and revocation; authoritative database verifies exactly one role-specific session per initial seeded account (later revoked), login-failed/MFA-failed/role-mismatch audit events and no JS/HTTP500 errors.

First test execution failed because the original `role=alert` element was observed *before its text populated*; `.autopilot/artifacts/M10306_SIX_ROLE_ENUMERATION_REAL_CHROMIUM.log` exit1. This is a **test synchronization error, not evidence of a product/account-enumeration defect**. The test now waits for a **visible nonempty alert** with an explicit timeout before comparing content. No product authentication code was changed.

Final actual command `node --test tests/browser/six-role-mobile-auth-boundaries.browser.test.mjs` → **1/1 PASS**, `TEST_EXIT=0`, **76.4s**. Raw `.autopilot/artifacts/M10306_SIX_ROLE_ENUMERATION_FINAL_CHROMIUM.log` logs `M10306_GENERIC_LOGIN_NONENUMERATION` for six roles × two widths, followed by original role/signout and DB audit PASS. No additional test identity or persistent local service; no new app code.

## Current accounting, remaining gates, next

Relevant planned `SCENARIO:M1.03.06:04` invalid input, `:11` role/API abuse and `:10` DB audit are **scoped evidence only**, NOT complete stage-certified 4975 slots. FULLY VERIFIED **0/218**, LEFT218, historic previously green **1392/1566** distinct source cases, older scoped **216/218** (not FULL), older planned partial **693/4975**, 54 uncertain, 4228 unlinked, FINAL certified **0/4975**. Independent pentest incomplete (2008 provisional attack candidates, independently completed unknown), HIGH/CRITICAL count UNKNOWN, known external blockers 10 minimum, RELEASE NO-GO. This checks visible error equivalence only, not response-time side channels or complete endpoint/rate-limit penetration testing, protected final-stage/provider acceptance or Owner UAT.

NEXT: update only original current-source SHA256 and dependent legacy SHA, verify 218/4975 evidence/index and engineering checks, guarded commit/push PR and exact-head real browser+inventory CI, signed two-parent QA merge + all exact merged-SHA workflows. Then original M1.03.07 *Exit Portal preserves session; Sign Out revokes it*—reuse previously green six-role signout tests, find first genuinely uncovered browser/API abuse/expiry case. M1.03.02 actual email and SMS remains BLOCKED_EXTERNAL.
