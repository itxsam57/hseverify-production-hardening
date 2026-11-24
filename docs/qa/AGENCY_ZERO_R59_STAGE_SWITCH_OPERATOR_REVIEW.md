# ZERO-R59 — Non-disruptive Stage Switch / Rollback Readiness Review

**Original M1.01.04 release recovery; one composite read-only case: BLOCKED_RELEASE_RECOVERY.**

- Official app pin 7ff30ea140a5145e5d5ba761f7c7aef24c895269. Live stage worktree HEAD 6a446de2f52e6866708c9bb7e750618660617443 is docs-only newer, though app src tree identical to pinned 7ff. Clean detached 7ff guard PASS, existing stage checkout strict SHA guard FAIL as designed.
- Live synthetic stage private HTTPS, PostgreSQL16 and outbox worker healthy. **No stage, private.env, shared DB or production change.**
- Examined actual start.sh, start-app.sh, run-outbox.sh, run-stage.mjs, status.sh, stage-metadata, source/Next manifests, R57 and R58 receipts. One end-to-end release switch preflight case, not eleven new scenario cases.

## Actual R59 preflight predicate results

- **PASS**: `live_stage_healthy_to_preserve`
- **BLOCKED**: `operator_reviewed_two_phase_stage_cutover`
- **BLOCKED**: `stage_current_metadata_matches_pin`
- **BLOCKED**: `standalone_binary_independently_signed_against_source`
- **PASS**: `strict_start_guard_on_clean_target`
- **BLOCKED**: `strict_start_guard_on_old_checkout`
- **PASS**: `target_clean_7ff_git_pin`
- **BLOCKED**: `target_pinned_bundle_preinstalled`
- **BLOCKED**: `target_pinned_worker_prebuilt`
- **PASS**: `target_source_tree_equal_to_live`
- **BLOCKED**: `verified_retained_latest_live_backup`

**4 passing readiness predicates, 7 unmet prerequisites; no live switch approval.**

## Operator-only safeguarded cutover plan — NOT EXECUTED

1. **Authorize candidate:** independent reviewer approves one exact frozen app source SHA, code, migrations, security results and adapter status. Proposed R36/R40 app fixes are separate unapproved QA source changes and cannot be silently repinned.
2. **Retain latest verified recovery point:** R58 validated a fresh synthetic stage 193-table/979-row dump but deleted it after the isolated restore. Before cutover an operator must create and securely retain a NEW encrypted access-controlled snapshot, record verified SHA256, and prove isolated restore of those exact retained bytes with app login + rollback validation. Old Nov21 backup is not latest.
3. **Prepare an immutable deployable bundle:** clean detached 7ff checkout currently lacks .next/standalone/server.js and .outbox-worker-dist/outbox/outbox-worker.js. Build/copy a vetted target and separately verified same-pin rollback target. Verify full source SHA, lockfile hash, Next BUILD_ID, required-server-files deploymentId, server/worker bundle SHA256 and an independently signed source-to-build attestation. Build metadata alone is not a signed chain.
4. **Validate strict guard, never weaken:** existing start.sh, start-app.sh and run-outbox.sh require HSE_RELEASE_SHA to equal git rev-parse HEAD. Check all THREE against the final target with no live state mutation. Confirm correct worker build present and no conflicting private ports/processes.
5. **Stage a reversible operator window:** named approver and rollback operator; use controlled stop/start on approved window only, preserve live private PG16, move HSE_STAGING_WORKTREE to approved pinned target and update stage-metadata.txt to actual SHA atomically with private file permissions and logging. Never expose private.env, stage token or keys. Do not roll back committed database history destructively.
6. **Prove deployed exact SHA:** readiness anonymous 401/authorized 200, all six truly authenticated role journeys (not merely login pages), authorized next-role handoffs, tenant denial, HTTPS, pending outbox idempotency, adapter contracts, code fingerprint and safe restart drill must pass before release readiness.
7. **Rollback on failure only to verified same-pin clean bundle:** the old docs-only 6a checkout must NOT be used as an unvalidated rollback target because the strict source SHA guard correctly rejects it. Validate database state, audit, credentials and outbox after rollback. Operator authorization still required before any stage mutation.

## Required disciplines

**ENGINEER — BLOCKED:** Healthy stage and clean 7ff checkout, but unprepared pinned artifacts/outbox in target, stale metadata and no reviewed operator switch/rollback execution.

**CYBERSECURITY — BLOCKED for release:** exact SHA guard operates fail-closed; independent signed build chain, retained backup, final penetration campaign, and operator authorization evidence absent.

**REVIEWER — BLOCKED:** Evidence is one compound read-only case with 11 subassertions, not 11 new original scenarios. No independently identified professional operator/reviewer approval; M1.01.04 remains open.

Private raw JSON SHA256: `c3832cd8897aa1077ee06bbae8f897ecee21c69fd9141bac97d4c7aa360dde62`. No sensitive data, credentials or dump committed. **TECH FULL 0/218, owner ready NO, production unchanged.**

NEXT R60–R68: nine selected single-case Chromium original M1.02–M1.03 tests, then R69 integrated release-provenance work and original scenario closure review.
