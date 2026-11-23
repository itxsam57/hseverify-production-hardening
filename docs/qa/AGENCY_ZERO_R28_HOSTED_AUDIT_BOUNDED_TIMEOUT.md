# ZERO-R28 — Independent audit job timeout and terminal artifact reliability (QA workflow only)

**Original canonical application source SHA** `7ff30ea140a5145e5d5ba761f7c7aef24c895269` unchanged. **Separate QA-only branch** `qa/zero-r28-bounded-full-ci-20261123`, base QA `313baae6df6c088b6d495d541b8ca09cbd352ffa`, already contains R21 original test fixture 0130-before-0121 rollback correction and R13 Poppler install. No application source or production mutation. Not a newly TECH FULLY VERIFIED scenario; 0/218.

## Hosted RED / cause boundary

Full independent hosted audit [45189020158](https://github.com/itxsam57/hseverify-production-hardening/actions/runs/45189020158), source SHA `08e47344c417df198e065945510df98f1329661e`, reached terminal **COMPLETED / CANCELLED** after ~65 minutes while the `Existing full regression gate cross-check after independent audit` step was still marked **in_progress**. The workflow specified a **60-minute JOB timeout**, and only its pre-crosscheck partial artifact was present: **no terminal FINAL-AUDIT.json was uploaded**. This timing is consistent with the job ceiling; exact GitHub cancellation initiator is not independently proven. Local captured GitHub run JSON status + original source ceiling red receipt: `.autopilot/artifacts/zero-r28-hosted-full-regression-cancelled-red.log`, SHA256 `643b9a74237cc49a91cdf9467ee931c1251e03d56456661b4c17b5dd44135a19`. **Never count cancelled as PASS.**

## Narrow QA CI repair

In `.github/workflows/independent-full-system-audit.yml` only:
1. Job timeout `60 → 120 minutes` (maximum, not an instruction to wait 120 minutes).
2. The existing full unweakened `npm run verify:full` is now invoked under `timeout -k 10s 5400s` (90-minute explicit cap). Its exit code remains captured in `commands.tsv` as `existing_full_regression_crosscheck`. **Exit 124 if timed out remains a real failure** and feeds the existing `node scripts/independent-audit-finalize.mjs` severity gate; it is **not** converted to a green test. The final full audit artifact upload and severity-enforcement steps remain `if: always()`.

**Scope caveat:** A runner interruption, external shutdown or GitHub-level cancellation can still prevent a final artifact; local static YAML checks do not guarantee a particular hosted outcome. Do not claim the new independent run is green before its exact terminal result and raw `FINAL-AUDIT.json` / full regression log / 218 test ledger are read.

**ENGINEER — QA WORKFLOW SOURCE CHECK PASS:** parsed actual workflow YAML, confirmed job timeout=120, captured full regression command includes 5400-second timeout, original `code=$?`/finalize remains, full artifact upload `always()`. No full hosted execution completed at authoring time.

**CYBERSECURITY — SCOPE CONTRACT PASS:** No application auth, provider, database or security test altered; full regression failure/timeout preserved as nonzero command, no gate bypass. Broad pentest and all adapters still unverified.

**REVIEWER — SOURCE CHECK PASS, HOSTED RUN PENDING:** Original cancelled red and exact SHA preserved. This is a CI reliability improvement only; does **not** certify the app or original 218 scenarios.

**Next:** Guarded QA-only commit/push and draft PR; dispatch an exact-head independent full audit, then inspect its terminal status, artifact, severity and cases honestly. Separate R27 draft PR #213 fixed an actually reproduced 320px Company Worker detail bug and proved one new Worker→Admin→Company A/B browser workflow (2/2 scoped browser passes), but **neither change is merged into the frozen candidate**. Other draft PRs #208–#212 remain unmerged; source-index reconciliation required after integrating new source tests. **0/218 TECH FULL, OWNER NOT READY, production unchanged.**
