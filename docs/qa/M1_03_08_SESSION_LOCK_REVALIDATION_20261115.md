# M1.03.08 — revoked/expired security-session TOCTOU and logout race

**Scope: local synthetic engineering evidence ONLY. NOT FULLY VERIFIED. Release NO-GO.**

- Frozen scenario: **M1.03.08** — password change, session revocation, privileged recovery.
- Tested source: isolated branch `qa/m10308-session-validity-20261115`, base QA SHA `f4884d757a7f56fea14a72f8d2fbe9d7e88f9fc1`; exact post-commit SHA to be recorded through PR/CI, NOT yet final release SHA.
- Autonomous guard receipt: `AUTOPILOT_V4_ACTIVE`, session `f694b43c-a667-4cd3-b40d-456d8c2df563`, cycle `590892676cf64d558662416590fe7f3e`; local skill reconstruction is NOT represented as upstream plugin recovery.
- All account data synthetic; PostgreSQL 16.15 isolated ephemeral test database; PGlite browser fixtures. No third-party/prod data, payments, disruptive staging actions.

## Reproduced RED and root fix

The original `AccountSecurityService` trusted the already-resolved request session inside credential/factor mutations; it did not recheck database revocation, identity/role or expiration under locks. In actual PostgreSQL16 the **revoked Worker session password change was ACCEPTED**, and a logout-committed stale request also succeeded. Original RED raw log:
`.autopilot/artifacts/M10308_SESSION_REVALIDATION_PG_RED.log`, SHA256 `a0bad4e0331b45a995924e7718b074ec64c51b48edbcad4a3e74c43f68ed096f`.

**Fix:** `src/lib/auth/account-security-service.ts` checks the matching active account row `FOR NO KEY UPDATE`, then active same-account/role/unrevoked/unexpired session `FOR UPDATE` **within the same transaction** before each of `changePassword`, `rotateRecoveryCodes`, `startMfaReplacement`, `confirmMfaReplacement`. The stable account→session ordering serializes concurrent password changes and logout; no fake reroute, lock bypass, or schema change.

## Actual test evidence (all passed in this isolated worktree)

| Test/command | Exact scoped result | Worktree raw log and SHA256 |
|---|---|---|
| `HSE_POSTGRES_TEST_DATABASE_URL=postgresql://ubuntu@127.0.0.1:39051/postgres node --test tests/platform/account-security-password-change-postgres.test.mjs` | **4/4 PASS**, 7.6s. Concurrent stale password single winner; revoked/expired/wrong-role and revoked recovery/factor-confirm denied without writes; logout commits before account lock→deny with zero events/audits; security locks first→logout waits and later revokes. | `M10308_SESSION_REVALIDATION_PG_LOCKED_V2.log`, `15fe9fb664f572ffd84aa2b93d1162c2f7d1575ff0f0d27094f7c0c41d0d0350` |
| `node --test --test-concurrency=1 tests/browser/password-change-boundaries.browser.test.mjs` | **1/1 PASS** actual Chromium Worker, Company, Assessor, Verifier, Admin, Root; 320/390; password reauthentication, copied/revoked session rejection, DB authoritative security audit, notifications and deep links. | `M10308_SESSION_VALIDITY_SIX_ROLE_CHROMIUM_20261115.log`, `45062728e58b7420b4187c8e3bbf00fdcc8a86e09d11b82fd5ed442462476874` |
| `node --test --test-concurrency=1 tests/browser/mfa-management-boundaries.browser.test.mjs` | **1/1 PASS** actual Chromium five MFA-protected roles Company/Assessor/Verifier/Admin/Root; new authenticator accepted, old denied, recovery code replay/wrong password/foreign account denied, DB factors, immutable audits, notifications. | `M10308_MFA_MANAGEMENT_POST_SESSION_LOCK_CHROME_20261115.log`, `125b8fd050e27836e9fe77d06aba84b9d3f857054ad1935f6c15c7280548bcd9` |
| `node --test tests/platform/account-security-business-rollback.test.mjs` | **2/2 PASS** controlled audit/queue failure rolls back account/session/password, no security event. Legacy fixture's expired October date corrected to future expiry to exercise actual rollback. | `M10308_BUSINESS_ROLLBACK_FUTURE_SESSION_GREEN.log`, `7d16384e0ec72aae3c06bbdb32050188e5048139e02b10500dda4cdcc60c36ef` |
| `npx tsc --noEmit && npm run test:account-security-audit && npm run test:account-security-notifications` | **PASS** exact zero exit; native audit and four role-bound notification tests green. | `M10308_TS_AUDIT_NOTIFICATIONS_20261115.log`, `d60930dbc1a0d61643d21e75e1b0afcca41ed47d9e1d71b8da7971e24f686f3c` |
| Canonical `python3 tests/engineering/test_prior_test_evidence.py`, `test_vertical_218_progress.py`, `test_4975_prior_reconciliation.py`, `node --test tests/engineering/current-release-218-ledger.test.mjs`, all original reconciliation `--verify` checks, `npm run audit:current-218-scenarios`, `npm run qa:progress-218` | **PASS** last canonical run, `CANONICAL_LEDGER_ENGINEERING_EXIT=0`; no forced final credit. | `M10308_LEDGER_FULL_INTEGRITY_FINAL_20261115.log` |
| Previous local real HTTP foreign-Origin browser action replay | **6/6 scoped PASS**, all foreign origins denied with original password and no completion events; independent final-stage CSRF validation still absent. | Five staff log `/home/ubuntu/work/hseverify-local-tools/M10308_FIVE_ROLE_FOREIGN_ORIGIN_ACTUAL_HTTP_20261115.log`, SHA256 `74becd41e9a6b8cd82597ed6c3805f9a73d24e6eea186b40c47cba8de440efcf` |

The earliest regression test's first race orchestration attempted logout after acquiring the security lock and deadlocked on its own artificial pause. Corrected the **test** to cover both real serializable commit orders. This is not treated as an application failure or a passing final-stage race.

## Original canonical counters (not interchangeable)

- **FULLY VERIFIED 0/218; LEFT 218. NO-GO.** Original A28 old scoped 216/218 (historical only).
- **Source test identities previously GREEN 1,394/1,570**, unmatched historical passing log 176. One *previously* independently evidenced PostgreSQL source name matched an earlier clean old log; new three test identities have current local passing logs but NOT prior-reference/finished-stage CI proof.
- **4,975 planned slots:** 693 historical PARTIAL; 55 UNCERTAIN; 4,227 UNLINKED; **FINAL 0/4,975**. 1 newly candidate-mapped title moved unlinked→uncertain; NOT a pass.
- **Pentest INCOMPLETE**; 2,008 provisional entrypoint/attack-family checks, independent completed count UNKNOWN, high/critical outstanding UNKNOWN; **known external blockers 10**.

## Remaining acceptance, pending PR and next step

Not proven yet: final exact SHA protected staging, independently completed role/tenant/API pentest, all applicable real providers including email/SMS, outage/retry/responsive/expiry coverage beyond the scoped cases, realistic load/restore, and Owner UAT. M1.03.08 remains `NOT_FULLY_VERIFIED`.

**NEXT:** guarded commit+push `qa/m10308-session-validity-20261115`, PR into `qa/a28-eligibility-read-guard-20261107`; verify actual exact PR-head PostgreSQL 16 + real Chromium + original 218/4,975 and Autopilot workflows, then merge only green and verify every merged-SHA workflow. If final-stage external gates are unavailable, retain M1.03.08 blocked for final acceptance and move to frozen next actionable `M1.04.01`, without duplicating proven tests.
