# HSE Verify — full pretest ground truth, all previous work, one 218-row Masterplan

**Date:** 2026-11-14. **Authoritative signed code/CI starting SHA:** `f5fe6eb8f5b522c7ed702c9591e8687f906025bb` on `qa/a28-eligibility-read-guard-20261107`, with **30/30 complete GitHub workflows SUCCESS**. This is a frozen **evidence bookkeeping baseline**; this audit did **not** run new application browser, API, provider, load or penetration tests. New audited bookkeeping changes need their own PR exact-SHA CI.

**Release stays NO-GO:** **FULLY VERIFIED 0/218**, 1 IN_PROGRESS, 10 known BLOCKED_EXTERNAL, 207 NOT_STARTED; complete independent pen test, exact protected staging, real providers, load/restore and Owner UAT all outstanding. The number of open severe security findings is **unknown**; do not claim zero.

## Original historical 216/218 claim finally reconciled

The exact original A28 checkpoint was reopened from `/home/ubuntu/work/hseverify-masterplan-release/.autopilot/artifacts/a28-current-218-scenario-map.json`. Its bytes are preserved, without modification, as `docs/qa/evidence/LEGACY_A28_SCOPED_218_CHECKPOINT_20261106.json` (SHA256 `85947e060449b1a6ea51d1937903a23c42df7f80ab5e654b9fd6aaae4fbb32b5`). Frozen ID/brick/role/statement matches all 218 current scenarios exactly.

| Old checkpoint measurement | Evidence-backed value | Correct interpretation |
|---|---:|---|
| Scenario IDs with any old scoped claim | **216/218** | A partial test clause existed on an **older** code SHA |
| Scenario IDs with no old scoped clause | **2** | **M1.01.03 and M1.01.04** in the old snapshot; since then M1.01.03 received scoped CI checks, M1.01.04 staging remains blocked |
| Old browser/native/local scoped references | **243 / 57 / 16** | **316** old log references, not 316 fully tested scenarios |
| Distinct old raw logs opened and SHA256 recorded | **154** | Real old workstation files examined, paths and hashes retained |
| Unambiguously clean whole-log green summaries | **307/316** | This is **log-level** pass evidence only, not whole-scenario or complete feature proof |
| Mixed/uncertain references | **9/316**, from **3 logs** | Manual review before treating individual clauses as passing |
| Scenarios with at least one unambiguously clean old log ref | **209/218** | Still **not fully verified** |
| Old claims with at least one uniquely matched current test title | **193/218** | Candidate associations; no automatic scenario pass |
| Distinct old-log-matching current green test identities | **375** | Candidates from old logs to help avoid duplicate tests |
| Candidate scenario↔test associations | **1,065** | May share one test across several scenarios; **not** 1,065 independent tests |

**The nine mixed references affect:** `M1.01.02`, `M2.13.03`, `M3.01.04`, `M3.07.02`, `M3.07.04`, `M3.07.05`, `M3.08.03`, `M3.08.05`, `M3.11.05`. A log containing a later `fail 0` alongside an earlier failing assertion is **MIXED**, never silently green. No legacy source SHA was substituted for the signed release SHA.

**The even older 2026-10-02 report** listed 47 browser suites `passed=1, failed=0` plus two extra journey variants reported as passing. All 47 suite source files still exist; their *original named .txt artifact files* were **not found in any of the 81 previously available worktrees**. Those 49 historical result claims remain in `docs/qa/2026-10-02-evidence.json` and are **not added** as fresh passed test instances. Where those suites later passed in independently readable logs, the current test-identity ledger already credits them once.

## Exact executable source test reuse at the signed pretest QA checkpoint

Read-only index searched current `tests/**/*.test.mjs`, the **82** preserved worktrees and historical `.autopilot/artifacts/*.log`, and **all 30/30 actual GitHub CI workflow logs** from `f5fe6e...`. Case identity is **source file + literal-prefix test title**, deduplicated across old logs and CI.

| Case identity class | Distinct cases |
|---|---:|
| Previously GREEN in signed reference QA CI logs | **235** |
| Additional cleanly GREEN in prior local runs only | **1,157** |
| **Total unique existing previously executed GREEN source test identities** | **1,392** |
| Current-source test identities without matching clean green execution proof | **174** |
| **Identified static Node test call-sites (starting reusable test denominator)** | **1,566** |

This is **1,392/1,566 (88.9%) of the presently indexed Node test call-site baseline**, not 88.9% of full consumer readiness, entire 218 workflows, 4,975 planned dimensions, or independent pentesting. Static parsing undercounts dynamically generated subcases, some test names from old logs cannot be uniquely matched, and Python/browser assertion varieties require a later reviewed expandable executable denominator.

**No test duplicated:** prior direct explicit scenario links account for **139 distinct passing test identities across 42 frozen IDs**. Original old-log-to-current-name matching supplies **375 unique candidate test identities**, of which **316** had **not** already received explicit scenario association. Their union gives **455** distinct tests with explicit or old-log scenario hints. The remaining **937** green tests are preserved individually in the search index, tagged `UNMAPPED` to an exact frozen ID, **not omitted, re-executed blindly, or fabricated into a scenario pass**. Shared platform/security cases can legitimately support multiple scenarios; source and assertions must be inspected before assigning credit.

**Every residual source case also has a review lane now:** `docs/qa/evidence/MASTERPLAN_218_UNATTRIBUTED_CASE_REVIEW_20261114.csv` lists all **1,110** cases lacking a direct scenario link or an old scoped-log case-name match: **937 previously green** and **173 without green execution evidence**. Pure title/filename overlap suggests up to three frozen IDs for **1,102** of these and flags **8** as cross-cutting/no plausible keyword match. These 1,102 are **unreviewed routing suggestions, NOT verified scenario mappings**. Verify source code and original logs before moving a candidate into a frozen scenario; this queue prevents old test cases from disappearing or being blindly retested. The additional **55 old log test-title identities that no longer uniquely match current source** are preserved with redacted previews and original log digest in the legacy evidence index, not silently dropped.

The frozen 4,975 provisional **planning slots** remain separate measures of missing acceptance: 2,616 scenario dimension proposals, 2,008 endpoint/action security-family candidates, 351 viewport proposals. They are **not** 4,975 already executable independent tests or equivalent to 1,566 source cases. Refine applicability during scenario triage, and raise the total only when a concrete mandatory additional case is proved.

## Authoritative single ledger and reuse tools

- `npm run audit:current-218-scenarios` is the **sole 218 release ledger** generator. Its `.autopilot/artifacts/current-release-218-ledger.json` contains the same frozen 218 scenario rows, `scoped_test_evidence` from previous executed tests, **and** `historical_scoped_216` from the original A28 log-backed claims; all `NOT_FULLY_VERIFIED` until full signed-stage acceptance.
- `docs/qa/evidence/MASTERPLAN_218_ALL_PREVIOUS_EVIDENCE_ACTIONS_20261114.csv` is a **218-row read-only work-queue VIEW**, not a competing status ledger. Every row includes frozen roles/description, older status, browser/native/local old refs, clean/mixed log counts, directly associated green cases, candidate matches, known external blockers, full missing acceptance categories and the next evidence-review action.
- `docs/qa/evidence/MASTERPLAN_218_LEGACY_216_OBSERVATIONS.json` contains the 316 original references, old source SHAs, SHA256s of each referenced old log and their claimed clause, conservatively classified; `scripts/reconcile-216-historical-scope.py --verify-index` validates the frozen counts offline.
- `docs/qa/evidence/MASTERPLAN_218_EXECUTED_TESTS.json` contains every uniquely identifiable current source test with historical and reference CI pass links; `scripts/reconcile-218-prior-test-evidence.py --verify-index` validates it. `--lookup-scenario M1.01.01` suggests reusable case identities without automatically crediting any scenario.
- `scripts/build-218-evidence-action-map.py --verify` checks that the 218-row work-queue view has not drifted from the original frozen scope and both evidence indexes.
- `docs/qa/2026-10-02-evidence.json` is the older unmodified 47-browser-suite source and 218 scenario source. We neither invent raw October artifacts nor inflate total case passes using self-reported summaries.

## What remains before running new product tests

1. **Review, don't rerun:** start with the 9 mixed references; cross-check raw test names and original per-scenario clauses, then map the 316 additional old-log case-name hints. Cases that lack exact ID attribution stay discoverable via the search index. No product tests needed for this paperwork.
2. **Prioritize missing behavior:** one representative *real browser* journey should assert UI controls and 320/390/desktop, expected negative and retry/expiry/race behavior, cross-role receiver/notifications, DB/audit and relevant direct-API misuse in the **same** run when safe. Reuse existing tests and add only the missing assertions.
3. **Independent security:** the 40 current HTTP method handlers + 211 current candidate server action exports form a preliminary **251-surface** authorization inventory; implement risk-based endpoint/role/tenant matrix plus specialized OTP, file, storage, CSP/HSTS, CSRF/XSS/injection/SSRF, session, proctor, webhook, payments and business-logic exploit checks. The old **178 security-themed passing test names** are reusable scoped evidence, not a completed pentest.
4. **Code/UI cleanup:** inspect actual failures before modifying; remove dead/duplicated code only after dependency and regression proof; preserve roles, audit and tenancy, check full cross-role UI and accessibility. No unreviewed cleanup.
5. **Stage and release:** see `docs/qa/PENTEST_STAGING_PREPARATION_20261114.md`. No standalone protected stage is confirmed; never run disruptive pentest/load against the shared Hands-Off workstation. Genuine integrations, isolated protected stage, realistic load/restore/rollback, findings remediation and Owner UAT all remain compulsory for 218/218.

**One-line scoreboard:** `FULLY VERIFIED 0/218 | EXISTING SCOPED TESTS 1392/1566 (235 reference QA, 1157 older) | OLD CLAUSES 216/218 | 9 UNCERTAIN REFS | PENTEST INCOMPLETE | 10 KNOWN EXTERNAL BLOCKERS | NO-GO`.

**No finite security testing can guarantee a hack-proof public system.** The release objective is demonstrably tested exploit resistance, ongoing monitoring and secure recovery, with no known unremediated critical/high findings at sign-off.
