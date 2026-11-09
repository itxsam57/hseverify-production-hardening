# M3.12 — GitHub-signed merge compliance gate repair (2026-11-09)

**Release status:** FULLY VERIFIED **0/218** · PENTEST INCOMPLETE · **NO-GO**.
All observations here concern repository governance only, not consumer workflow certification.

## Reproduced CI blocker

- QA source branch `qa/a28-eligibility-read-guard-20261107` advanced to GitHub-created merge commit `1fcd675c66aae19fce068035fb38f78deed6ad60` when PR #63 merged.
- GitHub Actions Autopilot Compliance run `42648420904` failed: `commit 1fcd675... has missing or invalid Autopilot-Cycle trailer`. The source commits `0f4f8dc` and `e0d4c4e` already have valid authenticated Autopilot session trailers and their audit chain was committed.
- Root cause: GitHub's automatic merge commit has no human-authored audit trailer, and the guard treated it as an unaudited regular commit. **Do not forge trailers, amend GitHub's signed merge, disable compliance, or force-push QA.**
- Independent inspection: exactly two parents `0ba89d31` and `e0d4c4e`; actual merged tree equals `git merge-tree --write-tree` on those parents; GitHub `web-flow` GPG signing fingerprint `968479A1AFF927E37D1A566BB5690EEEBB952194` validated using `git verify-commit --raw` after import of the official public key.

## Guard fix (new isolated QA branch)

The guard permits a **trailerless commit only** when all of the following hold:

1. It is an exact two-parent PR merge with GitHub's merge-message convention and GitHub committer metadata.
2. Cryptographic verification succeeds against a **pinned, isolated, committed public signing key**; no host keyring trust and no self-claimed signature.
3. The merge contains **no conflict resolutions or added changes** beyond the ordinary deterministic Git merge tree. Conflicts or altered merge trees fail closed.
4. **Every second-parent PR source commit** is independently validated for the full Autopilot cycle/feature/session provenance and nonempty audited activity; nested merges are recursively checked.
5. All regular commits, forged unsigned merges, partial/malformed trailers, missing signing keys and unaudited PR source remain denied.

Separately, the guard installer now **preserves** an already-managed stronger compliance workflow rather than silently replacing its canonical-range logic with a weaker fallback. Existing managed workflows without an executable guard command are explicitly rejected.

## Verification

- Baseline RED: `python3 .autopilot/guard.py ci --root . --base-sha 0ba89d31... --head-sha 1fcd675c...` (exit 2, missing merge trailer).
- Post-fix real GitHub merge + all PR source validation: `AUTOPILOT_V4_CI_COMPLIANT`, 3/3 unique commits authenticated, exit 0.
- Python adversarial signed-merge and installer tests: **9/9 PASS**, including forged unsigned GitHub metadata, wrong pinned key, missing key, altered merge tree, missing PR source audit, missing regular commit trailers and overwrite prevention.
- Previous canonical-range tests: **9/9 PASS** (unchanged fail-closed ancestry behavior).
- Guard installer reinstallation preserved the stronger CI workflow **byte for byte**.
- Test commands and stderr/stdout retained in `.autopilot/artifacts/M312_SIGNED_MERGE_CI_FIX_TESTS.log`; baseline RED in `.autopilot/artifacts/M312_GITHUB_MERGE_CI_BASELINE_RED.log`.
- The workflow adds the new adversarial test to CI without removing its existing range-selection test or its mandatory guarded-commit validation.

## Handoff / open gates

Do not confuse green merge compliance with production readiness. Exact protected staging, real providers, full M3.12 operational checks/incident recovery, all-role full end-to-end 218 reconciliation, complete pentest, realistic load and Owner UAT remain open.

After PR integration: confirm the **new GitHub-generated merge SHA** passes Autopilot Compliance and all other triggered checks on the actual QA head. If it fails, inspect GitHub Actions logs; do not bypass. Then return to M3.12.02–.03 executable alerts, rollback, and truthful non-misleading release readiness while leaving final GO blocked.

The worktree is isolated from all other in-flight HSE QA worktrees and tests.
