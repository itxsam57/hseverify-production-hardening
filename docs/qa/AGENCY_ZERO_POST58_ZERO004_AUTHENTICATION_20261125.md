# Original ZERO-004/058 - Six-role authentication, session and recovery

CURRENT TECHNICAL STATUS: 0/3 fully verified. Exactly FIVE new distinct source test cases on frozen pin 7ff30ea140a5145e5d5ba761f7c7aef24c895269 with TAP 5 PASS 0 FAIL 0 SKIP, scoped only. Prior original 3/3 browser cases in AGENCY_ZERO_BATCH_004_REPORT.md are preserved and not re-executed. All 58 original revisit groups still OPEN and tech confirmed overall 0/218.

## Actual new evidence and independent discipline slots per scenario

### M1.03.06 - Wrong-role, wrong-password/MFA and signed-out redirect

New distinct test cases: 2 (source TAP 1/1 PASS each). Modes: static/structural source, static/structural source.

- every login page binds one fixed role to one server action; source tests/platform/authentication-portal-isolation.test.mjs SHA256 f70959b5b091f75f00117e1324ec604f21f8335645595ea3eba5e7177f4ceaf8; 1 pass 0 fail 0 skip; raw log SHA256 fadff086a7635b2ae99783ed0a4f62fa5f38d3a28b7f1b300fe35ff85eb507f3.
- locked-account messaging is available only after password and role proof; source tests/platform/authentication-portal-isolation.test.mjs SHA256 f70959b5b091f75f00117e1324ec604f21f8335645595ea3eba5e7177f4ceaf8; 1 pass 0 fail 0 skip; raw log SHA256 1cb50d491d8601099d4df801e3f30b62e339e1ca2f2d00352dc64b78b44eab85.

ENGINEER: Two additional exact-pinned source-structure tests PASS: each of six login pages binds its own fixed-role server action; locked-account wording is only available after proof of both role and password. Existing original six-role 320/390 real Chromium wrong-password/MFA and cross-portal test remains historical scoped evidence.

CYBERSECURITY: Role-parameter confusion and locked-account enumeration boundaries reviewed with targeted structural guards. NOT full penetration coverage: live credential-stuffing/rate-limit, origin/CSRF, session fixation, all role/tenant API paths, and unknown high/critical findings.

REVIEWER: Raw TAP source assertions and existing browser source identities reviewed by AI; the two new tests are structural checks, NOT fresh real UX evidence. No independent full six-portal accessibility/security acceptance.

STILL OPEN: Manual adversarial six-role credentials/MFA/CSRF/rate-limit attacks, complete forms/mobile/a11y and independent reviewer signoff.

### M1.03.07 - Exit Portal retains session, Sign Out and active session revocation

New distinct test cases: 1 (source TAP 1/1 PASS each). Modes: real browser with disposable PGlite.

- Six-role active sessions preserve foreign accounts, revoke owned other and current sessions; source tests/browser/active-session-boundaries.browser.test.mjs SHA256 8df7dcb90f1c506b02577990db2c6f3bb2506dc75b5957c69fc450c4c2040ee3; 1 pass 0 fail 0 skip; raw log SHA256 31a9a33845fc7ac9ec8d51441e59bbd3ea6261911be9abf397c575101a49097d.

ENGINEER: Actual six-role Chromium active-session workspace each role: foreign-account tampering denied, own second session revoked, current session sign-out, protected page denied. Database check confirms exact owned revocations and immutable audit; earlier original Exit vs Sign Out and cookie replay test already passed and was not repeated.

CYBERSECURITY: Actual multi-role foreign-session and stale-own-session access denial performed; broader concurrent logout/revocation races, compromised-cookie replay across endpoints, subdomain CSRF and tenant boundary unauthorized reads still require targeted attack confirmation.

REVIEWER: Checked six actual role traces, audit and DB assertions, source SHA/log SHA; missing independent signed assessment of every modal/device, keyboard, mobile, browser-back and multi-tab lifecycle.

STILL OPEN: Systematic concurrent revoke/logout, arbitrary protected APIs after logout, complete mobile/keyboard/a11y, independent security and reviewer signoff.

### M1.03.08 - Password change, six-role recovery and privileged session revocation

New distinct test cases: 2 (source TAP 1/1 PASS each). Modes: real browser with disposable PGlite, isolated runtime PGlite.

- Six-role email recovery preserves MFA policy, revokes sessions and denies replay; source tests/browser/six-role-password-recovery.browser.test.mjs SHA256 c35e4a56e77406baa0a6fd2259b46e1718142395ef94a324a9fd953fce5736af; 1 pass 0 fail 0 skip; raw log SHA256 712268c0af4077a606af3fca9797165a6460e3586977f72ea88ca24a2ea00daa.
- Required queue failure rolls back actual recovery password, sessions, challenge, flow and completion audit; source tests/platform/account-security-notification-runtime.test.mjs SHA256 3fdd7c76f7a52921038c94377eb6486697ded54f7c5f1b37cbbe178c56beaa45; 1 pass 0 fail 0 skip; raw log SHA256 b7951d132035d989e0e01bf999740ece7734a170f49ec6ebfae7aac2e3f86b85.

ENGINEER: Fresh real Chromium six-role email password-recovery journey: MFA policy preserved, old sessions revoked, replay denied; real notification worker created correct role notifications and read/deep-link persistence. Separate runtime required-queue failure rolls back password, sessions, challenge, recovery flow and audit transaction. Prior original six-role password-change browser test reused without repeat.

CYBERSECURITY: Real role-bound one-use recovery and notifications plus fail-closed required-outbox atomicity verified. Comprehensive recovery-token brute-force/race, cross-role/tenant, attack against outbox/OTP adapter delivery, production provider and manual ASVS suite still incomplete.

REVIEWER: Verified actual browser six-role rows, notification projections, immutable audit assertions, runtime failed-queue rollback and raw SHA. Still missing independent code/a11y/API attack and adapter failure/retry/idempotency signoff for complete privileged recovery.

STILL OPEN: Real adapter-contract multi-outage/retry verification, concurrent password lock races on PG16, XSS/CSRF/OTP brute/replay adversarial testing and independent full UI/cross-role signoff.

## Source and private evidence integrity

- Combined five-test raw hashes and three-discipline review: /home/ubuntu/work/.hse-qa-tmp/agency-zero-post58-zero004-auth/ZERO004-three-scenarios-five-tests-three-review.json SHA256 f729a16a3b00144fb166987221433ac216f313b95adde7cab59fa3b38796d8b0. Each individual log and receipt in that private JSON records exact frozen source SHA, source/test SHA256, configuration fingerprint, Node version, time, command and expected/observed TAP result. No source, shared stage or production writes.
- No live email/SMS attempted. Full OWASP ASVS/WSTG manual cross-portal attack campaign, concurrency, CSRF/IDOR, failed OTP rates, accessible mobile/keyboard UI, independent signoff and required adapter contracts remain incomplete. Full-scope security high/critical findings UNKNOWN, never assert zero. Reviewer assessment here is AI model evidence inspection, NOT licensed external certification. Static source guards are scoped engineering checks, not substitutes for browser flows.
- No original scenario TECH_FULL award M1.03.06-.08. Original 218 scenario IDs and 58 initial batches retained and all 58 in revisit. Owner Testing Ready still NO, product source pin7ff unchanged.
- Separate PR224 QA SHA91702d8 full audit #45603019052 FAILED case-replay scoring criterion input count0 vs expected2. Frozen pin7ff isolated same case passed but does not clear cross-SHA regression; draft PR not merged, stage signed source-to-binary/approved rollback remains blocked.

## NEXT

Original ZERO-005/058 Authorization four source scenario units M1.04.01-.04. Inspect previous exact source evidence, run no more than five new source cases/workflows. Keep ZERO-001 through ZERO-004 OPEN and identified blockers. No new R-series.
