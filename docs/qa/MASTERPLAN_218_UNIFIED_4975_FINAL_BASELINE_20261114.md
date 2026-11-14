# HSE Verify — ONE master progress ledger after old-test deduplication

**Authoritative GO/NO-GO remains `npm run audit:current-218-scenarios` (218 frozen scenarios).** This reconciles the previously generated 4,975 *provisional dimension slots*, the original old **216/218 scoped-only checkpoint**, the **1,392/1,566 unique previous green source test cases**, historical logs/TSVs and 47 + 2 old summary claims. It does not create an independent release score or restart earlier tests.

**Signed QA reference before bookkeeping merge:** `1c9954a770edb9e9f1a23b1bab59e680fb5bdcc5`, after PR97, **30/30 exact merged-SHA CI workflow runs SUCCESS**. Exact baseline 4,975 planning-slot identities originated at older QA `8c60c0b789513f427fb56db3fa96dad4afe38d47`; the source entrypoint/page inventory remained the **same planned 2,616 + 2,008 + 351** when reconciled. Later code changes require an applicability check. **Public release remains NO-GO.**

## The exact progress counters — DO NOT ADD THEM TOGETHER

| Measure | Existing progress | Still outstanding | Counts *what* |
|---|---:|---:|---|
| Fully released frozen scenarios | **0/218** | **218** | All relevant role/UI/API/database/security/provider/stage/Owner UAT acceptance on the same final SHA |
| Previous **distinct source regression/test identities** with logged green result | **1,392/1,566** | **174** without known green execution evidence | Reusable historical engineering execution, not full application coverage; 235 from signed reference SHA CI and 1,157 older |
| Planned **4,975 dimension slots** with at least one old clean scoped clause **keyword-linked** | **693/4,975**, partial/needs review | **4,282** lack that precise clean old clause link | A transparent traceable old observation in the corresponding planning bucket, **NOT a passing complete check** |
| The 4,282 without a clean old scoped clause link | **54** uncertain only | **4,228** with no precise historical dimension link | 17 old mixed-log-only and 37 previous test-title-only suggestions; all need review before new test writing |
| Actual final-stage certified 4,975 planning slots | **0/4,975** | **4,975** | Full final protected-stage attestation — cannot substitute previous-SHA tests |
| Old 218 Masterplan scenarios with some previous scoped clause | **216/218** | 2 old checkpoint gaps | The original older claim, **not 216 fully verified** |
| Exact earlier security and UI evidence | 178 previous green security-themed test identities; browser/viewport assertions in old logs | Complete independent pen test and 251-entrypoint × 8 preliminary attack matrix; 117 pages × 3 viewports | Security-themed case **names** are not penetration-test signoff. Prior browser evidence exists, but no automatic final per-entrypoint/per-page certification |

**How 693 was calculated:** the original 316 A28 observations were read with source Git SHA, raw log SHA256, specific scenario ID and claimed scope; 307 references have clean whole-log green summaries, nine are mixed. An explicit old clause must mention the relevant positive/negative/retry/expiry/interrupt/race/role/DB/security/browser aspect. Negated old *not tested / not covered* caveats are excluded. Each `(frozen scenario, dimension)` is counted at most once irrespective of repeated test runs, multiple scoped clauses or shared browser suites. All 693 remain `OLD_SCOPED_CLAUSE_PARTIAL_REVIEW_REQUIRED` — a single clause does **not** prove the whole complex acceptance dimension. Rule-based associations are **triage, not human signoff**. The 54 remaining uncertain links have **no passing credit**.

**Crucially, the other 4,282 are not necessarily unexecuted:** the other 1,392 prior passing test identities and the original 47 browser/2 journey report claims are still indexed. Many test names lack enough precise scenario, viewport or entrypoint information to assign to a 4,975 slot. Avoid re-running them without inspecting source+original logs first. The 174 missing-green-source identities might be dynamic or not exercised; absence of readable proof is not a failure.

### Breakdown of 693 old partial dimension links

| Scenario dimension | Historical clean scoped clause references linked to distinct slots |
|---|---:|
| Browser controls/navigation | 111 |
| Responsive/keyboard/accessibility | 32 |
| Positive workflow | 118 |
| Invalid input/rejection | 70 |
| Retry/refresh/duplicates | 62 |
| Expiry/timeout/cancellation | 50 |
| Outage/recovery | 37 |
| Race/concurrency | 21 |
| Cross-role receipt/notifications | 39 |
| Persisted DB/audit/history | 109 |
| Role/tenant/API abuse | 44 |
| Real provider/stage/Owner UAT gate | 0 |
| **Total distinct scenario/dimension slots with partial evidence** | **693** |

**Dedicated security attack-family `2,008` and page × viewport `351` planned slots do not get automatic old full-credit** merely from test-case titles or scenario-level browser examples. An actual case-by-case endpoint/role/tenant and exact page+viewport attribution is needed. The 4,975 remains a **planning** count and can expand or adjust only when reviewed executable test coverage proves necessary. Never cap pen-test completeness at this count.

## Reusable files: no alternative release ledger

- Original **authoritative** command: `npm run audit:current-218-scenarios` → `.autopilot/artifacts/current-release-218-ledger.json` contains all 218 frozen scenario rows. It now embeds `planned_check_progress` and per-scenario `previous_partial_dimension_links` while retaining `scoped_test_evidence`, `historical_scoped_216`, and unchanged `FULLY_VERIFIED 0/218`.
- **4975 view:** `docs/qa/evidence/MASTERPLAN_218_4975_DEDUP_PROGRESS_20261114.csv`, **one row per original planning slot**, with old clause IDs, previous passing test ID candidates, original source SHA and explicit `NO` for complete dimension or stage certification. `...DEDUP_SUMMARY_20261114.json` is the validated aggregate input to the *same* 218 ledger. Verification: `python3 scripts/reconcile-4975-prior-coverage.py --verify`.
- **218 per-scenario next-action work queue:** `docs/qa/evidence/MASTERPLAN_218_ALL_PREVIOUS_EVIDENCE_ACTIONS_20261114.csv`. References all previous A28 logs, SHA256, 316 scoped claims, 1392 distinct passed test IDs and scope gaps.
- **Unassigned source cases:** `docs/qa/evidence/MASTERPLAN_218_UNATTRIBUTED_CASE_REVIEW_20261114.csv`, 937 prior-green + 173 without green proof, all **unreviewed lexical hints only**. Prior titles are never considered actual endpoint/role attack evidence without matching specific assertions.

## Minimal-run execution rule (ready for next actual test)

1. Open the next actionable frozen ID in the **218 work queue**, and existing `scoped_test_evidence` + `historical_scoped_216` + `previous_partial_dimension_links` first. Look up case source/log IDs, review whether the behavior is already proven at the correct role/object and whether current code changed it. **Reuse or extend**, do not rebuild an identical test.
2. Turn each required missing dimension into one or more independently executable concrete cases as needed. A single real browser journey may assert UI, positive/negative states, cross-role notifications, database/audit and direct API abuse together, while preserving clean failure attribution. Dedup by actual case ID and coverage slot, not number of invocations.
3. Use the existing Hands-Off workstation and current synthetic/test facilities for **non-disruptive inspection and authorized cases**. **Do not create a new localhost server or database just for accounting.** Inspect existing ports/processes and data separation before launching tests. Do **not** run intrusive cross-tenant exploit automation, full pentest or realistic load against shared workstation/public/third-party services without isolated scope and explicit authorization.
4. Full pentest/production-like provider/restore/rollback may ultimately require separate restricted staging; only provision it when the actual need, scope and protection requirements are confirmed. Real-provider prerequisites stay `BLOCKED_EXTERNAL`, never mocked into a passing provider stage.
5. On any code SHA/config change, update evidence/test mapping and invalidate affected certifications; add only genuinely missing scenarios/attack variants and keep one final 218 release outcome.

**Daily short status template:** `FULL 0/218 | EXISTING CASE PASSES 1392/1566 | 4975 PARTIAL EVIDENCE LINKS 693 (54 UNCERTAIN, 4228 NO CLEAN MATCH) | PENTEST incomplete | BLOCKED 10 | NO-GO`.

No tested system can guarantee zero future vulnerabilities; the release gate requires authorized comprehensive security verification, fixes and retests, risk review, monitoring and recovery readiness.
