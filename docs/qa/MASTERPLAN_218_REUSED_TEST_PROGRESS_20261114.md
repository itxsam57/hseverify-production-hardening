# HSE Verify — prior tests reused in the original 218-scenario release ledger

**Owner approved 1A + 2A:** count independently supported historical passing tests in **scoped engineering progress**, preserve the release-standard **218/218 FULLY_VERIFIED** counter and grow the test inventory when genuine coverage is needed. This is the same Masterplan mission, not a separate test project.

**Reference source/CI SHA:** `b85467e3d60fe3956ff5ed6b6510068d1b77c66b`, QA branch `qa/a28-eligibility-read-guard-20261107`. Actual signed 2-parent PR95 merge and **29/29 GitHub workflows green**, all 29 run logs downloaded/read for this audit. Future code/QA SHA changes do not silently turn older passing evidence into current-stage certification.

## Exact reusable, deduplicated prior-execution numbers

| Evidence | Distinct static Node test cases | What it proves |
|---|---:|---|
| Existing current-source top-level literal `test("...")` declarations across 545 `*.test.mjs` files | **1,565** | Source-defined *candidate* executable tests, not that they passed |
| Raw observed passing tests on the reference QA GitHub CI SHA (29/29 run logs read, 294 occurrences before deduplication) | **234** | Previously green on exact reference SHA, local/CI scope only |
| Additional distinct tests matched to historical clean passing logs, not included in the 234 | **1,157** | Previously green on an earlier configuration/SHA; must be revalidated if code/conditions changed |
| **Combined distinct prior passing test cases** | **1,391 / 1,565** | **88.9% of inventoried static Node test cases have at least one eligible prior successful execution** |
| Current-source test cases with **no matching clean green execution** in available logs | **174** | Missing proof, not proof that each test fails |
| Previously green cases with reliable exact frozen scenario association | **139** | Mapped across **42/218** frozen scenario IDs; *none* completely certified |
| Previously green cases not assigned confidently to exactly one frozen scenario | **1,252** | Kept as reusable named test evidence; must be linked when that scenario is worked, do not discard or double-count |
| Security-related *title* matching, previously green | **178** | Limited security-themed scoped tests, **not** an independent comprehensive penetration test |

**Source scope:** 81 isolated repo worktrees inspected, 1,933 historical `.log` files indexed outside the active audit worktree; of these, 1,154 had clean `ℹ fail 0` summaries with passing names and no failure marker. Historical repeated matching case observations were **5,451**; these collapse to **1,391 unique file+title identities** before separating the prior exact-CI reference. **221 unique unmatched/older log titles** and **32 unmatched/ambiguous CI case names** are **not** counted in the 1,565 static-source numerator, because a unique present source definition could not be proven. The 26 TSV files (146 rows, 98 green observations, 173 reported nonunique test pass counts) and earlier reports are preserved as additional hints, **not added again** as distinct cases.

The 1,565 denominator is specifically **current-source Node test call-site identities whose title begins with a literal**. Some names are dynamically concatenated or expanded in loops, and fully dynamic expressions are not yet enumerated; the eventual executable test denominator may be larger. It is not the total future executable acceptance matrix (which includes dynamic subtests, Python harness checks, browser actions per role, security attack variations, providers, and load/restore). The earlier **4,975** provisional coverage slots (2,616 scenario dimensions + 2,008 security attack candidates + 351 responsive page widths) remain **planned dimension slots**, **not** 4,975 executable `test()` declarations. Neither denominator should be subtracted from the other. Expand the planned executable total only when precise cases are catalogued and justified.

## One canonical ledger, not competing scoring systems

- **Original report:** `npm run audit:current-218-scenarios` → `.autopilot/artifacts/current-release-218-ledger.json`. Each of its **218 original rows** now has a `scoped_test_evidence` section (linked prior case IDs/CI/old green counts). Its top-level `scoped_test_progress` carries the global distinct test progress and unmapped count.
- **Underlying reproducible evidence:** `docs/qa/evidence/MASTERPLAN_218_EXECUTED_TESTS.json`, one row per 1,565 source test case, with stable file+test-title identity, prior proof references, SHA of available log, confidence of scenario association and pass status. `MASTERPLAN_218_EXECUTED_TESTS_BY_SCENARIO.csv` is a convenient view, not a competing ledger.
- **Read-only capture tools:** `scripts/collect-prior-qa-ci-tests.py` confirms 29/29 exact CI workflow results and extracts observed passing case names. `scripts/reconcile-218-prior-test-evidence.py` examines old logs without killing or rerunning tests, indexes unique file+title identities and can `--verify-index` offline; CI compares source-test content digest to prevent stale inventory silently passing.
- Repeated old or reference SHA runs **do not** add test progress twice. A source definition without an eligible successful observation has `NO_PASS_LOG_EVIDENCE`; a historical green case is `HISTORICAL_LOG_PASSED`, not a current SHA pass; one from actual prior-reference CI is `EXACT_CI_SHA_PASSED`. These are **scoped execution labels**, not `FULLY_VERIFIED`.
- When a current test file changes, review source/test hash and selectively rerun affected controls. Preserve the past result as historical; replace the evidence pointer with current exact SHA after actual execution. The 218 release counter remains **0/218** until the full relevant stages and approved independent pentest, provider and Owner UAT pass.

## No confirmed protected staging

Read-only workstation inspection found loopback listeners and workstation/VNC/Hands-Off services. No separate, protected, isolated, production-representative staging **was established or signed off** during this audit. We did not run load, brute force, disruptive pen-testing, migrations, provider calls, or destructive cleanup against the shared workstation. Continue focused browser/API tests in disposable isolated worktree + synthetic local DB; **do not** equate localhost to independently validated release staging.

**Release:** **NO-GO**. The original ledger remains 0/218 FULLY_VERIFIED, 1 IN_PROGRESS, 10 known BLOCKED_EXTERNAL, 207 NOT_STARTED. Full pentest: **incomplete**, critical/high-open finding count **unknown**, not zero.

## Efficient next actions — no duplicate-work loop

1. Start the first actionable frozen scenario, use its `scoped_test_evidence.linked_case_ids` to examine existing test source and logs **before** creating a new test. Search `MASTERPLAN_218_EXECUTED_TESTS.json` by exact features/roles when a scenario has no explicit link; the **1,252** unmapped older-green cases must be semantically reviewed and linked, never guessed into a PASS.
2. Run only missing acceptance variations or tests invalidated by changed code, state, role or provider. Combine one positive cross-role journey with UI, receiving notification, DB/audit and targeted API abuse assertions when safe. Keep independent adversarial penetration tests.
3. During code stabilization, remove confirmed dead code/duplicate routes only with regression coverage, fix underlying defects, inspect responsive UI at 320/390/desktop and preserve privacy/audit/tenant invariants.
4. Prepare an **isolated protected staging** backed by authorized synthetic data and test accounts, then real production-style provider acceptance, independent authorized pentest, realistic load/recovery/backup/rollback, Owner UAT and exact final-SHA evidence. Release signoff remains a separate strict gate.
5. After each meaningful test: update the existing 218 scenario evidence, case-identity status and SHA, failures and blockers. Progress line: `FULL 0/218 | REUSED TESTS 1391/1565 (234 prior-SHA CI, 1157 older) | PENTEST incomplete | BLOCKED 10 | NO-GO`. The 1,565 is a baseline that grows with new executable cases; never hide gaps or present it as the entire security coverage denominator.
