# M1.11.03 — frozen Skill review correction, older Chromium evidence repaired (2026-11-18)

**Release:** NO-GO, **FULLY_VERIFIED 0/218**. This is a **historical source-evidence linkage correction only** on the original frozen 218/4,975 system. It is *not* current exact-final-SHA browser acceptance, provider signoff, independent pentest or Owner UAT.

## Exact verified root cause and result

- Original case ID `tests/browser/independent-worker-review-e2e.browser.test.mjs#3a38443c403dd7a9` already had a genuine older signed-in real Chromium source covering independent Worker/Verifier **qualification, experience and skill** approvals/rejections/CHANGES_REQUESTED, version history and returning Worker UI state. Its historical status is `HISTORICAL_LOG_PASSED`, not current final certification.
- The M1.11.03 per-scenario source link was **0** despite the case covering skill. First source association edit only updated the test's scenario list but not the original per-scenario count, indexed CSV, 216 old association digest, 4,975 candidate view or action map.
- **Reproduced RED** using `npm run qa:progress-218` and `node --test tests/engineering/current-release-218-ledger.test.mjs`: `Historical per-scenario case count mismatch: 0 !== 1`. Raw worktree logs `.autopilot/artifacts/M11103_MAPPING_PROGRESS_RECHECK_20261118.log` and `M11103_MAPPING_LEDGER_TEST_20261118.log`.
- **Repaired** exactly one association without adding a unique source test/pass or changing any product service. M1.11.03 original `existing_source_cases_linked=1`, `green_history_only_cases_linked=1`; one existing source case previously associated with M1.11.01/M1.11.02 is now also correctly associated with M1.11.03.
- Rebuilt the original 216 historical index's current-test-source hash, exact original 4,975 partial/candidate view, 218-row action map and Python fixtures. All strict original 218/216/4,975 checks and 8/8 Node + Python source tests pass. Old green source identities remain **1,431/1,605**, unmatched 174; 66 frozen scenarios have at least one older linked green source, **not** 66 fully verified.
- Original 4,975 slots: **693 PARTIAL older scoped clues**, **92 UNCERTAIN title/mixed** (formerly 90), **4,190 no precise old link** (formerly 4,192), **0 final-stage certified**. Two candidate links were only classified for review, **not completed tests**. Pentest 2,008 provisional attack candidates independently verified count unknown; high/critical unknown; ≥10 external blockers.

## Not yet verified for M1.11.03

A focused **current exact-SHA skill-specific native two-client PostgreSQL16/PGlite scenario** for v1 CHANGES_REQUESTED→Worker corrected v2→fresh independent Verifier approval, wrong tenant/role/copy/replay/stale version, simultaneous reviewer claim/finalization, immutable database audit/notifications/receiving Company/Worker/Verifier screens. Current protected staging browser at 320/390/1280, genuine storage/scanning providers, comprehensive independent pentest, load/recovery and Owner UAT are missing. **Do not mark FULLY_VERIFIED**.

## Next exact work

Existing generic previous example: `tests/platform/independent-evidence-review-runtime.test.mjs` has the focused **M1.11.02 experience** wrong-role/stale-race test and hosted actual PG16 CI. Implement a **distinct M1.11.03 skill** source test using the same guarded test facilities without cloning entire DB/workspace, run named PGlite first; create hosted PostgreSQL16 exact-head workflow for the same skill test; perform relevant signed-in Chromium roles and direct-API abuse; fix any RED and run adjacent tests. Reindex original 1,605-source/218/4,975 evidence only after new test identity is proven. Continue with signed QA two-parent PR and independently verified exact merged SHA, keeping stage/provider/PENTEST/Owner UAT blocked.
