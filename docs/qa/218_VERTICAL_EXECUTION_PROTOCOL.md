# HSE Verify — permanent 218-scenario vertical verification and counting protocol

**Owner-approved 2026-11-14. Applies to all builders, QA agents and future ChatGPT chats until owner explicitly changes it. Read with root `AGENTS.md`, `PROJECT_MISSION_218_FULL_VERIFICATION_PENTEST.md` and `CURRENT_RESUME_218.md` before executing.** It extends the ORIGINAL 218-scenario mission; it does not create a competing release/test system.

## 1. One line of work, from 218 remaining toward zero

The work queue is the **existing frozen Masterplan order**, 218 IDs in 37 bricks, recorded in `docs/qa/evidence/MASTERPLAN_218_ALL_PREVIOUS_EVIDENCE_ACTIONS_20261114.csv`. Work on **one scenario ID at a time**, with an exact action and owned logs. Start with the first unfinished actionable ID (initially `M1.01.01`), but fix actual known-red regressions before continuing. Do not skip a role, tab, feature or workflow. Related checks may run together to save time; record each tested assertion separately against its applicable scenario/check ID. Reuse unchanged passing assertions and avoid restarting old suites without a reason.

Each focus ID gets a vertical **definition of done**: all relevant real forms/buttons/navigation, positive and negative input, retry/refresh/duplicate/expiry/cancel, interruption and races, UI desktop 320/390/1280 where relevant, accessibility, complete receiving-role state and notifications/deep links, persisted DB/audit/history, direct role/tenant/API tampering, case-specific independent security, real provider if required, and final protected staging + Owner UAT. The existing 12 Masterplan dimension slots are **coverage headings**, not guaranteed to be only 12 test functions. Expand executable cases only for proven missing paths; never limit needed assertions to an arbitrary number.

### Exactly how to execute each focus ID

1. **Preflight without changing product:** read active Git branch/exact SHA, V4 audit, running tests/worktrees/logs, source scenario and roles; inspect original `scoped_test_evidence`, `historical_scoped_216`, `previous_partial_dimension_links`, the 4,975 row-level CSV and `MASTERPLAN_218_UNATTRIBUTED_CASE_REVIEW_20261114.csv` first. Use `python3 scripts/reconcile-218-prior-test-evidence.py --lookup-scenario M1.01.01` with the actual ID. Test only what remains missing or is invalidated by changed code/config. The old 47 browser suite + 2 journey reports remain historical report claims where raw named artifacts were missing; don't add extra passes.
2. **Write an exact gap checklist:** pin each missing user action, role/sender/receiver, expected DB/notification/audit, denial, expiry/retry/race, relevant API abuse, viewport and external provider to one or more of the original frozen ID and proposed check IDs. Capture exact test input/output criteria before code changes; don't invent applicability.
3. **Execute one efficient representative cross-role journey:** use real existing synthetic-test browser/UI controls; submit, approve/reject/revoke/resubmit and verify *all* receiving roles, DB persistence, audit and notifications where the feature requires. Add targeted invalid, retry, duplicate, token replay, wrong-role, wrong-tenant and race assertions to the same coherent test setup when safe; keep independent individual assertion results. Do not claim that shared test setup passes all scenarios automatically.
4. **Investigate failures first:** reproduce RED, pinpoint root cause, fix compactly, rerun exploit + regression and neighboring flows. Remove dead/stale/duplicated code only after confirming usage, dependencies and passing regressions. Check responsive layout, focus, full keyboard access, private file controls and error/recovery states. Don't patch randomly or rebuild working code.
5. **Attest honestly:** link each executed test identity **once** to original case ID and scenario/planned check ID, exact git SHA, runtime/config, role/tenant/test identities (synthetic), command, exit code, actual browser/API/DB outcome, raw log/screenshot/trace/hash, security result, time and responsible reviewer. Repeated runs increase *execution log history*, **not distinct completed-test numerator**. A positive run on an old SHA remains historical scoped evidence, never final release acceptance.
6. **Close if and only if all applicable FINAL gates are proven:** a scenario becomes `FULLY_VERIFIED` only after every required field above has independent **protected production-like final candidate exact-SHA** proof, any exploit is fixed and retested, applicable real-provider behavior passes, the relevant shared load/restore/ops baseline is satisfied and Owner UAT/signoff is recorded. If a single requirement is missing or blocked, retain `IN_PROGRESS` / `BLOCKED_EXTERNAL` / `FAILED` and move to the next actionable ID. A scenario's missing final-stage dependency is **not** permission to claim it is fully verified or to restart it endlessly.
7. **Persist after each meaningful unit:** update original 218 release ledger's evidence and statuses **through audited code and verifiable attestations**, current case-index/4,975 views and exact evidence log, audit receipt, `CURRENT_RESUME_218.md`, and the next-ID cursor. Use guarded commit/push, verify exact branch/merge SHA CI, and leave next command. Update one test's progress only with test result evidence, not because a file was written or a CI workflow launched.

**Prioritize closure, not test volume:** when a scenario's missing conditions can all be satisfied safely, finish its positive/negative/cross-role/security/DB/viewport and required provider acceptance as one focused unit to turn `FULLY VERIFIED n/218` into `n+1/218`, reducing `REMAINING` by one. Where protected staging/provider/Owner acceptance is genuinely unavailable, finish the runnable scoped software evidence once, mark the exact blocker, then move forward. Never claim 217 remaining while the final stage is still missing. Future stage acceptance then closes the prepared IDs without repeating unchanged low-level tests needlessly.

### Work order, batching and blockers

Keep the original Masterplan scenario sequence (M1.01.01→M1.12.xx→M2.01.xx→M2.13.xx→M3.01.xx→M3.12.04), with 37 named brick groups below. Do not jump to easy CI checks solely to raise counts. Red/failing security or critical workflow work overrides ID order. A provider-blocked ID stays visible for revisit; move to the next safe ID, record the named service/credential/stage blocker and what real final proof is missing. All six roles, role-to-role receiving transitions and cross-tenant API boundaries must be covered. Final cross-brick journeys, independent pentest, configuration/ops, real providers, realistic load/restore/rollback, and Owner UAT are a **final exact-SHA release reconciliation**, not substitutes for feature-level tests.

**No unnecessary local services:** reuse approved existing Hands-Off workstation synthetic test facilities where safe. Do not start a duplicate localhost application/DB, delete other worktrees, kill running tests or alter shared service configuration merely for accounting. Separate restricted staging is necessary before disruptive/full pentest/load or real external-provider acceptance if the shared host cannot safely isolate these operations. Get owner approval for the explicit attack scope and load ceiling before invasive exercises. The platform can never be guaranteed unhackable; final release needs comprehensive authorized findings closure and secure monitoring/recovery.

## 2. All progress counters are mandatory — never silently omit one

Every test update and every `continue` uses the SAME canonical ledger output from `npm run audit:current-218-scenarios` plus `npm run qa:progress-218`. These values measure **different units** and are not summed or subtracted from one another:

| Counter | Signed QA reference baseline before later changes | When it actually changes |
|---|---|---|
| **FULLY VERIFIED** | `0/218` — **218 remaining**, 1 IN_PROGRESS, 10 known BLOCKED_EXTERNAL, 207 NOT_STARTED | Only independently attested full frozen scenario on same final staging SHA (every applicable gate) reduces remaining by **one**; reopening failed/invalidated proof can increase remaining |
| **SOURCE TEST CASES previously GREEN** | `1,392/1,566` (235 green in old reference SHA CI, 1,157 other old green, 174 without matched green) | Distinct `source path + stable test name` or explicit new test-case ID with **actual passing log**. Failed/pending/code-only not passed. New cases grow denominator; historical old passes remain labeled old, don't falsely call them current |
| **PLANNED CHECK SLOTS with an old scoped clean partial link** | `693/4,975` **PARTIAL, NOT COMPLETE** | Only on raw verified scoped test observation matching the correct frozen scenario/dimension, independent unique check ID and reviewed assertion; do not add multiple passes from one duplicate test |
| **UNCERTAIN older check links** | `54` (17 mixed-log-only + 37 title-only) | Only move after detailed source and actual outcome review; no automatic PASS |
| **NO PRECISE OLD DIMENSION LINK** | `4,228` | Can reduce as a real independent scoped case is correctly mapped; missing a link doesn't mean the feature was never tested |
| **FINAL-STAGE VERIFIED PLANNED CHECKS** | `0/4,975` — 4,975 still pending final acceptance | Only when the whole applicable planned check has exact-SHA current protected-stage proof, not one old screenshot, code assertion, or CI subset |
| **HISTORICAL SCOPED SCENARIO CLAIMS** | `216/218` old A28; 316 old refs, 307 clean-summary, 9 mixed | Historical forensics, not a new release count; should stay intact unless original evidence corrected with provenance |
| **PENTEST** | `INCOMPLETE` — 2,008 provisional entrypoint×attack-family slots, 178 prior green security-*titled* cases (not independent pentest proof), severe finding count **UNKNOWN** | Count executed independently evidenced **specific entrypoint/role/tenant/attack** checks, verified re-exploitation denials and findings closure. Do not report `0 critical` without independent assessment |
| **EXTERNAL BLOCKERS** | 10 **known** external IDs, not exhaustive | Move one only after real provider/protected-stage proof; retain newly discovered blockers visibly |

The 4,975 estimate = **2,616 scenario×12 dimension planning slots + 2,008 preliminary security-candidate slots (251 entrypoints×8 attack families) + 351 responsive-page slots (117 pages×3 widths)**. It is **not** 4,975 executable Node tests, and all combinations are still subject to applicability review. Expand the executable total when a missing mandatory case is actually demonstrated; never delete a needed test to keep 4,975 neat. The previously green 1,392 cases cannot be subtracted from the 4,975 compound planning slots. New test evidence must maintain both numbers and all four 4,975 buckets without double-counting.

## 3. Mandatory compact response after every testing unit

Run `npm run qa:progress-218` and use its actual counters, then report the exact test just run and next action. At most four compact lines normally:

`FULLY VERIFIED n/218 | LEFT 218-n | RELEASE NO-GO/GO | NOW: Mx.xx.xx — exact action/result`
`TEST CASES GREEN p/t (historical/current distinguished) | NO MATCHING PASS t-p | OLD SCOPED 216/218 (not full)`
`PLANNED 693/4975 PARTIAL | 54 UNCERTAIN | 4228 NO PRECISE LINK | FINAL CHECKS 0/4975`
`PENTEST incomplete (2008 preliminary attack slots; completed independently verified count unknown) | BLOCKED 10 | NEXT: exact executable check/command`

Also show failing or blocked ID, exact SHA, test logs/PR, security findings (critical/high **unknown** if not assessed), and result on the updated release source when material. Do not announce counts changing just because a PR was merged; only actual verified pass evidence can change them. If the task is an audit/planning action, label `NOW: planning/ledger, no new feature acceptance`.

## 4. Durable next-chat resume, no repeat questions

Read in this order: `AGENTS.md` → `PROJECT_MISSION_218_FULL_VERIFICATION_PENTEST.md` → `CURRENT_RESUME_218.md` → **this file** → `docs/qa/218_VERTICAL_EXECUTION_CURSOR.json` → canonical command and 218-row action CSV → existing relevant source tests/logs. Check signed latest remote QA branch and live workstation before any action. Start the `current_focus_scenario_id` and `next_exact_action` from the cursor unless a real known-red failure takes priority. If the cursor is outdated, reconcile it with live release ledger and update **with evidence**. Log active PID if a test continues. Handoff always states exact branch/SHA, case, failed/unverified checks, evidence paths, known blockers, next exact command and risk to shared services. Never claim autonomous work after chat ends.

> Machine progress/cursor is just a **view on the original 218 ledger**. It is not a parallel status system. The canonical ledger's `FULLY_VERIFIED` and exact SHA decide release status, not this document or a code-name tally.

## Appendix: exact fixed Masterplan brick order (218 scenario IDs, 37 bricks)

This is a navigational index for the **existing** frozen queue; the 218-row CSV contains the complete description, roles, old proof and next-action for each ID.

- **M1.01 — 4 scenarios:** Environment and release foundation; `M1.01.01` through `M1.01.04`
- **M1.02 — 5 scenarios:** Global UI; `M1.02.01` through `M1.02.05`
- **M1.03 — 8 scenarios:** Authentication; `M1.03.01` through `M1.03.08`
- **M1.04 — 4 scenarios:** Authorization; `M1.04.01` through `M1.04.04`
- **M1.05 — 4 scenarios:** Audit and notifications; `M1.05.01` through `M1.05.04`
- **M1.06 — 5 scenarios:** Uploads; `M1.06.01` through `M1.06.05`
- **M1.07 — 7 scenarios:** Identity; `M1.07.01` through `M1.07.07`
- **M1.08 — 5 scenarios:** Company verification; `M1.08.01` through `M1.08.05`
- **M1.09 — 6 scenarios:** Organization and Team; `M1.09.01` through `M1.09.06`
- **M1.10 — 6 scenarios:** Invitations and employment links; `M1.10.01` through `M1.10.06`
- **M1.11 — 8 scenarios:** Evidence and supervisor observation; `M1.11.01` through `M1.11.08`
- **M1.12 — 5 scenarios:** Public verification and concerns; `M1.12.01` through `M1.12.05`
- **M2.01 — 8 scenarios:** Assurance Orders and Cases; `M2.01.01` through `M2.01.08`
- **M2.02 — 5 scenarios:** Evidence review handoffs; `M2.02.01` through `M2.02.05`
- **M2.03 — 6 scenarios:** Frameworks and Effective Policy; `M2.03.01` through `M2.03.06`
- **M2.04 — 6 scenarios:** Question Bank; `M2.04.01` through `M2.04.06`
- **M2.05 — 6 scenarios:** Randomized forms and exposure; `M2.05.01` through `M2.05.06`
- **M2.06 — 7 scenarios:** Eligibility, applications and funding; `M2.06.01` through `M2.06.07`
- **M2.07 — 7 scenarios:** Assessment delivery; `M2.07.01` through `M2.07.07`
- **M2.08 — 8 scenarios:** Interruption and recovery; `M2.08.01` through `M2.08.08`
- **M2.09 — 5 scenarios:** Integrity; `M2.09.01` through `M2.09.05`
- **M2.10 — 7 scenarios:** Written scoring and review; `M2.10.01` through `M2.10.07`
- **M2.11 — 6 scenarios:** Interview scheduling; `M2.11.01` through `M2.11.06`
- **M2.12 — 8 scenarios:** Interview console; `M2.12.01` through `M2.12.08`
- **M2.13 — 7 scenarios:** Decisions; `M2.13.01` through `M2.13.07`
- **M3.01 — 5 scenarios:** Credentials; `M3.01.01` through `M3.01.05`
- **M3.02 — 5 scenarios:** Passport and Living Record; `M3.02.01` through `M3.02.05`
- **M3.03 — 5 scenarios:** Scoped sharing; `M3.03.01` through `M3.03.05`
- **M3.04 — 5 scenarios:** Company Action Centre and directory; `M3.04.01` through `M3.04.05`
- **M3.05 — 6 scenarios:** Billing; `M3.05.01` through `M3.05.06`
- **M3.06 — 6 scenarios:** Reports; `M3.06.01` through `M3.06.06`
- **M3.07 — 6 scenarios:** Appeals and continuing assurance; `M3.07.01` through `M3.07.06`
- **M3.08 — 6 scenarios:** Operational administration; `M3.08.01` through `M3.08.06`
- **M3.09 — 7 scenarios:** Privacy and accessibility; `M3.09.01` through `M3.09.07`
- **M3.10 — 5 scenarios:** Production adapters; `M3.10.01` through `M3.10.05`
- **M3.11 — 5 scenarios:** Certification; `M3.11.01` through `M3.11.05`
- **M3.12 — 4 scenarios:** Launch and operations; `M3.12.01` through `M3.12.04`
