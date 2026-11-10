# Current final-release 218-scenario ledger — fail-closed procedure

**Release is NO-GO.** A local build, passing historical browser test, native regression suite or successful GitHub check is not proof that an entire frozen scenario is fully verified on the same protected final deployment SHA and configuration.

## Which command to use

```bash
npm run audit:current-218-scenarios
```

Works from a clean clone/worktree without untracked historical log files. Reads the frozen `docs/qa/2026-10-02-evidence.json`, verifies all 218 unique scenario IDs, 37 bricks and the pinned fingerprint of every scenario's ID, brick, family, role list and description. Rejects any change to frozen scope. Uses `git rev-parse HEAD` to record a full 40-character exact source SHA.

The machine-readable output is `.autopilot/artifacts/current-release-218-ledger.json` (and is uploaded by the targeted GitHub Actions gate). Each row includes exact SHA, original roles/description, current release verification state, explicit acceptance dimensions still missing, known blockers, empty current-SHA *full evidence* and separately labelled historical scoped status. The report never converts a historical `passed` or a successful subset into `FULLY_VERIFIED`.

**Current status meanings:** `NOT_STARTED` means **complete final-SHA release certification has not started or is not evidenced for that scenario**, not that the feature was never developed. `IN_PROGRESS` is not a counted pass. `BLOCKED_EXTERNAL` lists known provider/staging dependencies; its count is a known **minimum**, not an exhaustive list. `FAILED` and `FULLY_VERIFIED` remain zero until genuine exact-SHA per-ID evidence exists. The ledger currently refuses to certify any scenario because the required comprehensive proof has not been supplied.

For historical forensics only:

```bash
npm run audit:historical-218-evidence
```

This retains the **unaltered strict historical script**, requiring its old A26/A28 logs from the original worktree. It can fail when those actual logs are absent. Do not fabricate files, copy earlier-SHA logs into a new checkout, treat its historical clause mapping as current certification, or suppress its errors to create a PASS.

## Before a scenario can be promoted to FULLY_VERIFIED

Record real exact-SHA protected-stage browser/UI actions, positive/negative/race/retry/expiry/outage, complete cross-role receiving state and DB/audit/notifications, direct tenant/role/API abuse, relevant exploit/fix/retest, real provider delivery where applicable, realistic load/restore/rollback, and Owner UAT. Reconcile *all 218* after any code/configuration change. A future governed evidence-attestation path must independently verify every required dimension; do not simply edit a status field to claim PASS.

**Current next step:** finish protected-staging external dependencies, execute feature-by-feature exact-SHA tests, then build an independently verifiable per-ID attestation mechanism. Until then, **0/218 FULLY VERIFIED, complete pentest incomplete, release NO-GO**.
