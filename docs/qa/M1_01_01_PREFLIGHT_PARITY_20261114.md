# M1.01.01 — production preflight parity, scoped test receipt

**NOT FULLY VERIFIED**: protected deployment, live providers, owner UAT and independent final pentest remain untested. No server, database or provider call was made.

**Already tested; do not repeat blindly:** seven historical green command groups, 17/17 native/Chromium checks and three HTTP smoke groups, old merged QA SHA `497a06cd174d02c634291e6f5524e9f85074956b`, source receipt `hseverify-m101-runtime-20261110/docs/qa/M1_01_01_RUNTIME_QA497A_SCOPED_20261110.md`. Separate M1.01.02 real PostgreSQL16 134-up/down migration tests and drift fix are already in merged PR70.

**New RED on QA parent `8706ffd5e2961ad26636b37e18b21db5cf462f9d`:** `scripts/lib/environment.mjs` deployment preflight accepted invalid public HTTP URL, incomplete OTP email and malformed SMS SID even when `src/lib/config/environment.ts` rejected all three. Python+Node test `tests/engineering/test_m10101_preflight_runtime_parity.py` failed 3 of 4 cases. Raw log `.autopilot/artifacts/M10101_PREFLIGHT_PARITY_EXPECTED_RED.log` in worktree `hseverify-m10101-preflight-20261114`.

**Root fix:** validate production OTP email key/from, SMS SID/token/sender and public HTTPS origin in the script using the same fail-closed rules as runtime. Nothing changes in demo, sandbox or signing-key gates. Existing test server was not started.

**Local GREEN after fix:** 6/6 targeted Python/Node validators/CLI cases; real `node scripts/validate-environment.mjs` rejects bad inputs, accepts synthetic valid config. Adjacent native environment/signing 17/17 PASS, Next config 4/4 PASS, TypeScript PASS, lint exit0 with nine unrelated warnings. Logs `.autopilot/artifacts/M10101_PREFLIGHT_PARITY_CLI_GREEN.log`, `M10101_ADJACENT_NODE_REGRESSION.log`, `M10101_NEXT_CONFIG_REGRESSION.log`, `M10101_TYPECHECK.log`, `M10101_LINT.log`. CI workflow `.github/workflows/m10101-production-preflight-parity.yml` reruns on PR and QA merge SHA.

**Counting:** these six newly executed **Python/CLI scoped checks** are not part of the frozen 1,566 historical Node test identities. No 218 scenario, full 4,975 planning check or independent penetration-testing slot is certified by this patch. Keep all baseline counters unchanged; link this new test to M1.01.01 until exact merged-SHA CI passes, then retain evidence as current scoped work.

**Remaining:** protected production-like exact SHA startup and PostgreSQL migrations; real provider secrets/delivery; deployed TLS/header scan; recovery/rollback; owner UAT and comprehensive final pentest. M1.01.02 is historical scoped but not stage-certified. Next inspect exact candidate CI for M1.01.03, note external staging block on M1.01.04, proceed to M1.02.01 safe missing browser behavior without repeating old local tests.
