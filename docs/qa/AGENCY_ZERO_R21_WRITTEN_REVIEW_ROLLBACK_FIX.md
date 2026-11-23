# ZERO-R21 — Independent audit written-review rollback fixture correction (QA only)

**Frozen application source SHA** `7ff30ea140a5145e5d5ba761f7c7aef24c895269`; no application, migration implementation, staging or production source change. Separate isolated QA branch `qa/zero-r21-written-review-rollback-20261123` forked from QA SHA `752d4cfc37f9f4e82b1cab9bc08cfef6783af70e`. This is one related notification rollback/security workflow containing at most **four executed distinct test cases**. **SCOPED PASS only; 0/218 TECH FULL, OWNER TESTING READY NO.**

## Exact independent hosted audit red and local proof

- [Hosted independent audit 45178421779](https://github.com/itxsam57/hseverify-production-hardening/actions/runs/45178421779) on QA-only SHA `8e8ee7921db306f2fadcfdcd53e15103ddcf6cff` **terminal FAILURE**. Sole critical in the final audit is `existing_full_regression_crosscheck` exit1, not independently established exploitable vulnerability. Original `tests/platform/written-review-assignment-runtime.test.mjs` first source case failed `P0001: Appeal response notification contract drift prevents rollback` because the test removed migration 0121 before first removing newer 0130 notification-function wrapper. **81/82 PASS** in that broader source suite; this test was the single failing case, not the entire app.
- Downloaded immutable final audit `FINAL-AUDIT.json` SHA256 `cc46c6bf51df3081553023146d380e3ac5c0a95f4620bc81471cb3d948e39b4c`; independent hosted `existing_full_regression_crosscheck.log` SHA256 `02786312ab2d908c7e842b414e7bf2883a02d81402dba87c52525572f04c4537`. Hosted verdict **DEFECTS_FOUND: critical 1 / high 0 / medium 14 / low 61 / info 61**.
- **Reproduced locally before any edit:** exact original first source case **0 pass / 1 fail / process exit1** `P0001`, source test SHA256 `941d1085edf6786bfbb5feac223608a894c6433d6c62838bc08a6acb81e60a87`. Private log `/home/ubuntu/work/.hse-qa-tmp/agency-zero-r21/R21.baseline-red.log` SHA256 `2f01960e795cf6d31f126b682d08f1c77608befcc1bc790e1aad9f101c24af46`.

## Minimal correction and validation

In the **first test only** in `tests/platform/written-review-assignment-runtime.test.mjs`, prepend:

```js
await f.database.execute(readFileSync("database/migrations/0130_verified_identity_correction_notices.down.sql","utf8"));
```

directly before the existing 0121 down, followed by unchanged 0120 down, 0118 down and 0118 up. This is the same accepted rollback dependency ordering already used by the test `tests/platform/interview-finalization-runtime.test.mjs`. No removed assertions, no disabled drift guard, no changed production DB migration.

**Four distinct scoped source case executions passed:**
- Exact former red first case: **1/1 PASS exit0**, source test changed SHA256 `7323a5a879a8961fd7504db131850425d768abf04c45db2aec67333680f2cbc7`, private TAP SHA256 `4ca82dda6480ff6dcc09717ae71d878c256956cf5228856bf280e871e9ce5dbd`.
- Entire original written review assignment source file **3/3 PASS exit0**: uncalibrated reviewer excluded, Admin recovery after calibration and MFA, reassigned cleared review still finalizes against pinned score; private TAP SHA256 `47cdfc677df9b5c66ac62d3b5b6a26724b26bd721ee7cc8331a85f1069d26d13`. (The first case appears in both targeted and 3-case suite; **do not double count**. Three unique cases in this source.)
- Related `0111` rollback fail-closed prior regression **1/1 PASS exit0**, source SHA256 `81806452e32eda7f42adf8b2b7a95a15bfb8a3a77804315571e73c2324b65e61`, private TAP SHA256 `9540881ae5b346bf29ca6b450bd06e866c1e9acb91ae8334d7e8b2eb4e1d27c1`.
- **Total unique source tests 4/4 scoped PASS** on isolated PGlite. No live protected staging or external provider test inferred.

## Historical archive mismatch (do not silently rewrite)

`docs/qa/evidence/MASTERPLAN_218_EXECUTED_TESTS.json` currently archives **561 source test files / 1,610 distinct historical test identities**. The newer QA parent SHA `752d4cf` already contains a newly committed R18 browser file, so actual source test file count is **562 before this R21 edit**. Therefore the frozen index's `current_test_source_content_sha256` no longer matches current source *even before this edit*. **Do not simply replace its checksum** while leaving 561/1,610 metadata inconsistent, and do not erase/renumber the historical 1,610 cases or 218 original scenario IDs. Dedicated append-only reconciliation of added QA tests into the historical-source map is still required; not a TECH FULL award.

## Three role disciplines

**ENGINEER — SCOPED PASS:** A real failing test was reproduced and fixed by one changed test fixture statement; all three related source workflows and existing migration regression check passed. Runtime app code untouched.

**CYBERSECURITY — SCOPED PASS:** SQL migration dependency and fail-closed contract remain enforced; no trigger/function protections weakened. No independent pentest, production Postgres rollback or broader migration recovery signed.

**REVIEWER — SCOPED PASS:** Baseline and corrected raw tests, exact SHA, four unique case identities, three QA source outcomes, archive mismatch and residual hosted failure clearly distinguished. Full hosted audit rerun on the exact new SHA remains required before clearing CI known-red.

**NEXT:** Guarded commit/push this one-line test-only fix, create QA-only draft PR, run fresh hosted independent full audit on exact pushed SHA; classify terminal result without inventing green. Fix separate R18 repeated cold-login timeout and reconcile source index append-only before any candidate repin or full 218 certification.
