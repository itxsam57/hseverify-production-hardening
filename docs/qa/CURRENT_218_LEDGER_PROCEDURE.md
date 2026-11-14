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


## Mandatory previous-test reuse and 216/218 historical-clause baseline (2026-11-14)

This remains **ONE** original 218-scenario release ledger, not a new competing test target. The same CLI now also includes per-row `scoped_test_evidence` and `historical_scoped_216`. Separate committed JSON/CSV files are **evidence sources and views only**. From an isolated worktree:

```bash
# Read past evidence without running product tests:
python3 scripts/reconcile-218-prior-test-evidence.py --verify-index
python3 scripts/reconcile-216-historical-scope.py --verify-index
python3 scripts/build-218-evidence-action-map.py --verify
python3 scripts/triage-218-unassigned-tests.py --verify
# See actual prior source tests for one frozen scenario (DO NOT AUTO-CREDIT suggestions):
python3 scripts/reconcile-218-prior-test-evidence.py --lookup-scenario M1.01.01
# The unchanged canonical GO/NO-GO command still controls the full 218:
npm run audit:current-218-scenarios
```

Exact prior checkpoint: 216/218 frozen IDs carried an A28 **old-SHA scoped-clause claim**, 316 references across 154 old logs (307 unambiguously clean full-run logs, nine mixed/inconclusive), with no whole-scenario release pass. Two old-map IDs lacked a clause, `M1.01.03` and `M1.01.04`; this does **not** imply the former lacks newer CI. Independently 1,392 distinct source Node test call-site identities have previous green observations out of 1,566 static candidate cases (235 in the signed f5fe QA CI logs, 1,157 older, 174 no matched green proof). 375 old-log source cases give only candidate associations; automatic credit is prohibited.

The archived old `2026-10-02-evidence.json` also has 47 suite pass claims and 2 additional journey claims, whose named original `.txt` artifacts were not found in the available worktrees. Do **not** increment green case counts from those summaries. Consult `docs/qa/MASTERPLAN_218_COMPLETE_PRETEST_BASELINE_20261114.md` and the 218-row `docs/qa/evidence/MASTERPLAN_218_ALL_PREVIOUS_EVIDENCE_ACTIONS_20261114.csv` before writing a new application test. Each suggested case must be inspected for actual assertions and exact scenario applicability; duplicates and unchanged regression coverage should be reused rather than rewritten.

Final authorized pentest requires a **protected isolated stage**, real providers and owner-specified safe attack/load scope; the current shared workstation is not a certified stage. See `docs/qa/PENTEST_STAGING_PREPARATION_20261114.md`. Only a fully independently attested exact-final-SHA scenario may increase the FULLY_VERIFIED count.

## Before a scenario can be promoted to FULLY_VERIFIED

Record real exact-SHA protected-stage browser/UI actions, positive/negative/race/retry/expiry/outage, complete cross-role receiving state and DB/audit/notifications, direct tenant/role/API abuse, relevant exploit/fix/retest, real provider delivery where applicable, realistic load/restore/rollback, and Owner UAT. Reconcile *all 218* after any code/configuration change. A future governed evidence-attestation path must independently verify every required dimension; do not simply edit a status field to claim PASS.

**Current next step:** finish protected-staging external dependencies, execute feature-by-feature exact-SHA tests, then build an independently verifiable per-ID attestation mechanism. Until then, **0/218 FULLY VERIFIED, complete pentest incomplete, release NO-GO**.
