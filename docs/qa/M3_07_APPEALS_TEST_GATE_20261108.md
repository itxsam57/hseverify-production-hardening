# M3.07 appeals and reassessment verification-gate mapping — 2026-11-08

**Release: NO-GO. FULLY VERIFIED: 0/218. Complete pentest: incomplete.** All evidence here is **scoped local PGlite/Chromium** on source baseline SHA `74978c853a70a228a55f093ed330c9734d460dfd`; not protected staging or production provider signoff.

## Confirmed test-gate defect (RED)
The frozen scenarios `M3.07.01`–`M3.07.06` cover credential appeals, independent reviewer, outcomes, Living Record, replacement reassessment and renewal. However `npm run test:m3-07` invoked **only** `privacy-operations-runtime.test.mjs` and `privacy-operations-migration-stack.test.mjs`, while `test:integration` invoked `test:m3-07`. A passing integration run would not establish appeal verification. The controlled QA script assertion exited 1, evidence `.autopilot/artifacts/20261108-M307-misrouted-gate-RED.log`.

## Root correction
- `test:m3-07` now executes **11 native credential-appeal / independent reviewer / outcome / followup / evidence / Assessor-interview / reassessment/replacement test files**, deterministically with `--test-concurrency=1`.
- Existing privacy tests remain unchanged under newly named `test:privacy-operations`; `test:integration` runs **both**, avoiding removal of privacy coverage.
- No production application code, auth policy, database schema or provider behavior changed by this mapping correction.

## Evidence before and after
- Before patch, SHA74978: **11/11 native groups PASS, 26/26 native subtests** across `.autopilot/artifacts/20261107-M307-exact749-status.tsv` and `20261108-M307-exact749-deep-native-status.tsv`; **6/6 actual Chromium groups PASS**: accepted independent review and Living Record version, rejected stale Admin form, scanned evidence exact bytes, Admin–Worker–Assessor interview and final review, Worker self-funded explicit reassessment new case, Worker/Company/public/PDF credential validity. Browser log index `.autopilot/artifacts/20261108-M307-exact749-browser-status.tsv`.
- Updated canonical scripts on isolated worktree: `npm run test:privacy-operations` **14/14 PASS**; `npm run test:m3-07` **26/26 PASS**. Source log `.autopilot/artifacts/20261108-M307-fixedgate-test-m3-07.log`; exit status TSV `.autopilot/artifacts/20261108-M307-fixedgate-results.tsv`.
- TypeScript and lint exit statuses recorded in that TSV; inspect before final commit.

## Incomplete / next
Retest committed/rebased exact QA SHA and GitHub CI. Run a dedicated **direct signed-in API abuse test** of `POST /api/credentials/[credentialId]/appeals` with foreign Worker evidence IDs, invalid body and duplicate/replayed submissions; UI currently checks owned evidence but the API boundary does not visibly perform equivalent checks. **This is a hypothesis pending controlled reproduction, not a confirmed exploit.** Repair and retest any confirmed issue without modifying unrelated worktrees.

All 218 full release certifications, complete six-role staging pentest, real external provider delivery, realistic load/restore and Owner UAT remain outstanding.
