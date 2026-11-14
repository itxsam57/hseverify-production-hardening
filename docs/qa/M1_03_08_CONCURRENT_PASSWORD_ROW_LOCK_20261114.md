# M1.03.08 — concurrent password-change root fix (scoped; NOT FULLY VERIFIED)

Frozen scenario: **Password change, other-session revocation and privileged recovery**. Canonical signed QA base: `b9b816a784c3051142568865c70cf958d0e493a6` (PR #112, 31/31 merged-SHA CI). Isolated branch `qa/m10308-password-change-race-20261114`; audit session `d7eb0b22-f2fd-4258-9c16-0bb3d962509f`, cycle `250810a5fdb345a38e9a6fccf8b9e309`.

## Reproduced product defect and root cause

Two independent authenticated synthetic Worker PostgreSQL transactions both verified the SAME existing password and each completed a password change, revoking both sessions. Actual database outcome: **two successful changes, zero active sessions, two security completion events and two immutable audit events**. The existing `verifyCurrentPassword` read did not lock the account credential row and the later update did not check its old hash. A deterministic new real PostgreSQL service regression (`tests/platform/account-security-password-change-postgres.test.mjs`) reproduced the defect (1 expected RED). The original source-code defect is therefore **confirmed, not merely inferred**.

**Minimal code repair:** Add `FOR NO KEY UPDATE` to the `auth_accounts` password-hash SELECT inside the existing account-security transaction. This serializes reauthentication and concurrent account-security mutations while permitting foreign-key audit KEY SHARE reads. No schema or public route changes.

After the repair, the *same real PostgreSQL test* passed **1/1**: first transaction succeeds, competing transaction waits and returns `Current password is incorrect.`, one winning session remains active, with exactly one security event and one audit record. Separate disposable PostgreSQL 16 database, synthetic test account, migration parity; no production or shared tenant data.

## Exact local evidence

| Scope | Command | Result | Raw log and SHA256 |
|---|---|---|---|
| PostgreSQL defect RED | `node --test tests/platform/account-security-password-change-postgres.test.mjs` | Expected 0/1, both accepted | `.autopilot/artifacts/M10308_REAL_PG_CONCURRENT_PASSWORD_RED.log`, `5f8b8d66408376e018927963ec53a2dc33906c1a7647c2a031cd85988abb1610` |
| Same PG exploit retest | same command against fixed working tree | **1/1 PASS** | `M10308_REAL_PG_CONCURRENT_PASSWORD_FIXED.log`, `975e72fd4093252f9f86df59260f8fca31726fe2d424e30ff2160cd68d7b604e` |
| Native rollback/audit/notification | `node --test --test-concurrency=1 tests/platform/account-security-business-rollback.test.mjs tests/platform/account-security-audit-runtime.test.mjs tests/platform/account-security-notification-runtime.test.mjs` | **10/10 PASS** | `M10308_ACCOUNT_SECURITY_NATIVE_REGRESSION.log`, `e42002f4c82d1b63105ad9bfb1b7081e48807b6443e4589a92957874a30502f1` |
| Actual six-role Chromium | `node --test tests/browser/password-change-boundaries.browser.test.mjs` | **1/1 PASS** | `M10308_SIX_ROLE_PASSWORD_CHANGE_BROWSER_FIXED.log`, `679dc7cdf16903e97ed28f103da5119661d9ce81788cd7ddab53b80a72410e77` |
| Canonical 218/4975 engineering | Python 5+9+4 and Node 8 | **26/26 PASS** | `M10308_LEDGER_AND_COUNTER_TESTS.log`, `2168b7dcfd24bfc34fd1868b854e359fa6ac940bebf62e55a7e65ef0cc383f4c` |

Six-role real browser regression covers Worker, Company, Assessor, Verifier, Admin and Root: invalid old password/MFA denied, correct new password accepted, mobile 320/390 layout, current session preserved, other session/cookie replay denied, persisted security audit and role-specific notification/deep link. Initial browser test infrastructure failed because Next.js Turbopack could not resolve symlinked `node_modules`; corrected *worktree-only* with `npm ci`, final suite passed. Typecheck **PASS**; lint **exit 0** with nine unrelated pre-existing warnings. Exact new-SHA GitHub Actions job added alongside prior real Chromium and native jobs.

## Canonical counters and remaining release gaps

Original frozen ledger remains **FULLY VERIFIED 0/218, LEFT 218; NO-GO**. Historical unique-source green **1393/1567**, **174 without prior matched green**. Prior baseline 1392/1566; one separately sha256-confirmed clean old QA216 source test upgraded, and one new source case added to denominator. The new PG test's fresh passing log is **local working-tree scoped** and is not falsely relabeled historical reference CI or final stage. Previously reviewed scenario mappings preserved; 216/218 A28 historically scoped (307 clean, 9 mixed of 316 refs). Unassigned case review 1110 (938 prior green, 172 without green); text suggestions not credited.

Original **4,975** provisional planning slots: 693 old PARTIAL; 54 UNCERTAIN; 4228 UNLINKED; **FINAL 0/4975**. Independent penetration testing **incomplete**, 2008 provisional attack candidates (independently verified count UNKNOWN), HIGH/CRITICAL count UNKNOWN, 10 known external blockers minimum.

M1.03.08 still needs protected production-like final exact-SHA stage, HTTPS/Origin/CSRF and direct role/tenant/API tests, additional role-specific concurrency/expiry/outage and recovery, production email/SMS, independent full pentest, realistic load/restore and Owner UAT. **NOT FULLY VERIFIED** even with the local root-cause fix.

**NEXT:** Guarded commit+push feature branch and PR to `qa/a28-eligibility-read-guard-20261107`. Require exact PR-head 3-job real PostgreSQL+Chromium+native CI, original 218/4975 integrity and Autopilot compliance; merge only green signed two-parent QA and verify all merged SHA workflows. Resume the next uncovered M1.03.08 Origin/CSRF/role test without duplicating unchanged passing cases.

## PR-head integrity correction (2026-11-14)

Initial PR #113 exact head `fb244ebe77ea7e8383250368946614f3b90d6bfe` had a **RED 4,975 integrity CI job**: the retained `tests/engineering/test_legacy_216_evidence.py` still hard-coded old 937 historical green unassigned / 173 unproven, while original 218 ledger's independently verified expanded index now has **938 green / 172 unproven**. This was an outdated *test expectation*, not an additional application defect. Updated both asserts; the exact 4,975 job's full command sequence was run locally with all relevant tests **PASS** (including 5/5 legacy). Raw `.autopilot/artifacts/M10308_PR113_4975_CI_REMEDIATION.log`. The correction must pass a NEW exact PR-head CI SHA; no earlier red check is counted green.
