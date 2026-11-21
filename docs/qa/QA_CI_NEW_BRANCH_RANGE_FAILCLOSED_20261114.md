# CI governance recovery — new QA feature branch first-push range selection (scoped)

Date: 2026-11-14 Asia/Karachi. QA approved base `5410bcf8397f1c596adf787e2fbdcdfc93e108aa`, current PR #92 branch `qa/verify-m10404-stale-role-20261113`, initial guarded head `94c47ebde029f3525e7ca899c6e4505dd404a6a9`. Worktree `hseverify-m10404-stale-role-20261113`. V4 recovery feature `QA-CI-NEW-BRANCH-ANCESTOR-20261114`.

**Release NO-GO; FULLY VERIFIED 0/218; comprehensive pentest incomplete; ≥10 known external provider/staging blockers.**

## Confirmed RED — a real GitHub run, not inferred

On initial branch creation, push event GitHub run [43328222558](https://github.com/itxsam57/hseverify-production-hardening/actions/runs/43328222558) failed in the real `Autopilot Compliance / Verify guarded commits` job. The event's `BEFORE_SHA` was 40 zeroes, so workflow `.github/workflows/autopilot-compliance.yml` selected a merge-base against the **old** `qa/masterplan-completion-20260926` ref rather than the current approved `qa/a28-eligibility-read-guard-20261107` candidate release tip. It scanned unrelated inherited imported history and rejected legacy `c4125a31b47c6bf803b55a6ce056c302f1473d4f` with missing Autopilot-Cycle trailer. Local exact real reproduction:
`python3 .autopilot/guard.py ci --root . --base-sha ae064c82ff17f88677fce5b7ec13569cd839d7bc --head-sha 94c47ebde029f3525e7ca899c6e4505dd404a6a9` -> **exit 2**, matching GitHub. Receipt `.autopilot/artifacts/20261114_CI_FIRST_PUSH_OLD_CANONICAL_RED.log`.

The same exact PR head passed real GitHub [Chromium and native jobs](https://github.com/itxsam57/hseverify-production-hardening/actions/runs/43328281045) and [PR-specific Autopilot compliance](https://github.com/itxsam57/hseverify-production-hardening/actions/runs/43328280866); initial **branch-push** RED still required root-cause remediation. No bypass of guard, hooks, signing, or CI.

## Narrow security-preserving remediation

- For **only new push events with a zero `BEFORE_SHA`**, resolve the current QA release tip from `git ls-remote --exit-code origin refs/heads/qa/a28-eligibility-read-guard-20261107`. This avoids stale/missing local remote-tracking refs; no mutation of other worktrees.
- Move range base from old canonical merge-base to QA tip **only if** the canonical reference is present, canonical is its ancestor, QA tip is a **proper ancestor** of the exact pushed head, and the tip is not equal to head.
- Any missing/unrelated/stale/moved QA reference falls back to existing fail-closed canonical/zero behavior; no arbitrary ref can suppress unguarded candidate commits. Existing branch pushes, PR event exact base/head, and the actual `python .autopilot/guard.py ci` gate remain unchanged.
- Native TDD baseline: **13/15 PASS, 2/15 FAIL** on the missing QA boundary; `.autopilot/artifacts/20261114_CI_FIRST_PUSH_QA_RANGE_TDD_RED.log`.
- After fix: `node --test tests/engineering/autopilot-compliance-range.test.mjs` **15/15 PASS** (`.autopilot/artifacts/20261114_RANGE_FINAL.log`), `python3 -m unittest discover -s tests/engineering -p test_autopilot_signed_merge.py` **9/9 PASS** (`.autopilot/artifacts/20261114_MERGE_FINAL.log`).
- **Real first-push branch workflow shell replay**: executes the unchanged workflow `run: |` body with actual source and current Git ancestry, `EVENT_NAME=push`, `BEFORE_SHA=000...`, `HEAD_SHA=94c47eb...`, and actual live remote GitHub QA tip; uses a temporary `python` alias to this ARM workstation's installed `python3` without modifying the command in CI. **exit 0, `AUTOPILOT_V4_CI_COMPLIANT`, 1 new source commit checked / 1 authenticated**. Receipt `.autopilot/artifacts/20261114_REAL_FIRST_PUSH_QA_BASE_FINAL.log`. No production data or providers touched.

## Remaining and next gate

This fixes a real CI governance deficiency, **not** a Masterplan scenario. Source and browser workflow code for M1.04.04 is unchanged and already passed actual locally signed-in Chromium 1/1, native 9/9, TypeScript and lint, and PR #92 head's GitHub Chromium/native/PR compliance checks. **NEXT**: guarded commit/push this workflow + regression tests + report and checkpoint; verify new exact head GitHub PR Chromium/native/compliance and branch push CI, require all green, then signed two-parent merge and independently validate all exact merged-SHA workflows. Separate PR #90 report export remains unmerged with its own pending/failing runner; do not misclassify it. Exact final protected staging and configured providers, complete six-role penetration testing, realistic load/restore, owner UAT and all 218 strict reconciliations remain open. Release NO-GO.
