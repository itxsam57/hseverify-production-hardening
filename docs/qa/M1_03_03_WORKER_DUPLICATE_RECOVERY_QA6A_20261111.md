# M1.03.03 — Worker duplicate registration and recovery (scoped QA, 2026-11-11)

**Release:** NO-GO. **FULLY VERIFIED:** 0/218. **Pentest:** incomplete. Do not promote this frozen scenario.

## Isolation and source
- Active QA base: `qa/a28-eligibility-read-guard-20261107` at `6a8ca6225f219a99f171f99150bd767de649b3c6`; isolated branch `qa/verify-m10303-duplicate-recovery-20261111`, worktree `hseverify-m10303-duplicate-20261111`.
- This checkpoint is a **dirty working tree on the base SHA**, not yet an exact committed/deployed candidate. All tests use local synthetic accounts, PGlite, Chromium and Next. No external account, real provider, production data or protected staging was tested.
- Existing V4 audit session `fdc53ed5-e663-46e8-b6a6-768764516b71`; no other worktree modified.

## Reproduced coverage defect and fix
1. Baseline source acceptance RED (not an application exploit): browser test used globally shared `/tmp/independent-audit-credentials.json` and lacked real 320px responsive/focus checks. Source assertion log `.autopilot/artifacts/M10303_RECOVERY_FIXTURE_COVERAGE_RED.log`.
2. Test-only fix: seed credentials in the disposable private PGlite directory (`HSE_AUDIT_CREDENTIALS_PATH`); browser checks duplicate registration at **320/390/1280px**, recovery keyboard focus at **320px**, no horizontal overflow, incorrect OTP error at **390px**, replay denial and authoritative DB/audit preservation.
3. New CI workflow initially invoked `worker-identity-initial-contact-binding.test.mjs` without its mandatory compiled runtime fixture. Reproduced **setup failure** (combined native invocation exit 1, 13 recovery cases passed and one fixture-precondition failure). Corrected the workflow to use the official `npm run test:worker-identity-corrections` compiler/runner; it provides the runtime env automatically. **This was a test harness defect, not a demonstrated product fault.**

## Observed green commands
| Command | Result | Scope |
|---|---|---|
| `node --test tests/browser/worker-duplicate-recovery.browser.test.mjs` | exit 0, 1/1 | Real Chromium duplicate contacts, 320/390/1280, wrong OTP, password/session replacement and replay; identity/evidence and audit DB comparisons |
| `node --test tests/platform/auth-recovery-otp-runtime.test.mjs` | exit 0, 13/13 | All six roles, five failed OTPs, cooldown/expiry, rollback, wrong-role and unknown flow, replay and session invalidation |
| `npm run test:worker-identity-corrections` | exit 0, 12/12 | Compiled identity repository including initial verified contact binding; corrections, read/authorization, rollback |
| Earlier unmodified `node --test tests/browser/worker-two-otp-accounts-duplicate-assessment.browser.test.mjs` on same QA base | exit 0, 1/1 | Two independently email+phone OTP-verified accounts cannot duplicate permanent Worker identity or apply twice |
| `npm run typecheck` | exit 0 | Strict TypeScript |
| `npm run lint` | exit 0, 0 errors, 9 pre-existing warnings | Static lint |
| `npm run audit:current-218-scenarios` | exit 0 | Frozen 218 IDs, 37 bricks; 0 fully verified, 1 in progress, 10 known external blockers, 207 not started |

- Workflow parses under PyYAML with two intended jobs. **Actionlint unavailable locally; GitHub CI has not run on these uncommitted changes.** Do not record YAML parse as Actionlint or CI PASS.
- Machine results: `docs/qa/evidence/M1_03_03_QA6A_LOCAL_RESULTS.tsv`; exact command stdout/exit records: `.autopilot/artifacts/M10303_QA6A_20261111_*.log`. Previous two-account browser result: `.autopilot/artifacts/M10303_QA6A_worker-two-otp-accounts-duplicate-assessment.log`.

## Unfinished acceptance and next action
- **NEXT FIRST:** Governed commit only these verified test/CI/evidence changes; rerun exact committed-SHA browser + native + CI, push an isolated PR to the current QA branch, require both real GitHub jobs and all existing checks, then confirm signed QA merge SHA.
- M1.03.03 is still **NOT_FULLY_VERIFIED**: complete protected final staging, true email/SMS delivery, cross-role/tenant direct endpoint/CSRF abuse beyond currently exercised cases, expiry/interruption/races, genuine load/restore and owner UAT remain missing. External prerequisites are `BLOCKED_EXTERNAL`, not PASS. Preserve concurrent worktrees and production.
