# ZERO-R36 — Real Company Workforce CSV formula neutralization and tenant/permission preservation

**Original-related bounded batch:** M3.06.06 (CSV formula manipulation) with existing M1.04.02 Company Workforce export/search authorization. **One distinct real Chromium cross-role Company directory workflow extended**, plus **one narrow existing CSV encoder source-regression case**; total <=5 test units. No prior original scenario is TECH FULL certified: **0/218**, 37 original groups, 58 original batches remain OPEN. Frozen original app SHA `7ff30ea140a5145e5d5ba761f7c7aef24c895269`. Isolated QA-only branch `qa/zero-r36-workforce-csv-formula-20261124`, starting from safe QA test baseline `752d4cfc37f9f4e82b1cab9bc08cfef6783af70e`. Do not merge into the pinned candidate, staging, or production without independent integration review and all release gates.

## Verified actual RED: existing Company Workforce CSV route missing formula protection

`src/app/api/company/workers/export/route.ts` previously used a local `csvCell` function that **only surrounded cells with quotes and doubled embedded quotes**. That was inconsistent with `src/lib/reports/report-delivery-domain.ts:createReportCsv`, which already neutralizes leading `= + - @` and whitespace-prefixed formula inputs with an apostrophe.

Extended `tests/browser/company-workforce-pagination.browser.test.mjs` to seed **two genuine Company-linked Worker names** (revoked status, retaining existing active filter expectations) containing `=SUM(1,2)` and whitespace/tab-prefixed `+SUM(4,5)`. A real authenticated Company owner requested `GET /api/company/workers/export` in Chromium, asserting actual downloaded CSV prefixes. Against the untouched original application route the test **FAILED exit1** at `Untrusted = formula must be apostrophe-neutralized in real CSV export`. The endpoint returned HTTP200; the original source's implementation has no neutralization, and the same test passes with the sole route fix. **Actual product CSV export safety defect reproduced, no provider or hypothetical-only issue.**

- RED command: `node --test --test-concurrency=1 tests/browser/company-workforce-pagination.browser.test.mjs`; process exit **1**, TAP 0 pass/1 fail, approx 31s.
- Raw private RED: `/home/ubuntu/work/.hse-qa-tmp/agency-zero-r36/R36-original-company-workforce-formula-red.log`, SHA256 `b83849d12383dcdc384fe9dfb50e64a4aeae99eb8a10d17eb375084aee7ee31c`; adjacent `R36.red.receipt.json`. Guarded red receipt `.autopilot/artifacts/zero-r36-workforce-csv-original-formula-red.log`.
- Exact unpatched route source SHA256 `7d736ece0aa0fc8c16a8697b1cc8d27cf9eb64b522c24e9825aac8d4bbb29fbb`.

## Minimal verified QA fix, original cross-role workflow kept intact

The only application change replaces the unsafe bespoke CSV helper with `createReportCsv` from the already-existing, separately tested report-delivery domain module. The mapped named fields, header order, quoted CSV shape, HTTP response and headers remain equivalent; **Company permission guard, tenant-scoped search, original report query, filters, pageSize 100, no-store and attachment response unchanged**. The encoder neutralizes formulas before quoting while preserving underlying Worker text.

Re-ran the **same real Chromium test case** on this isolated QA route change: **PASS exit0, TAP1 pass/0 fail/0 skip, ~48.5s**. It checked all the original directory workflows and both new formula fields:
- Actual two formula-labeled Company Workers exported as apostrophe-neutralized CSV cells; no bare formula cells.
- Authorized owner active filter kept 26 active Workers, excluding revoked; revoked Worker records remained available to the authorized owner without unscoped permission.
- Forged tenant/account/role query params and headers could not change true Company scope; unlinked foreign Worker absent even on unfiltered export.
- SQL-like search returned no unrelated rows; unauthenticated Company export denied.
- Original 1440/390/320 Workforce search, keyboard, Next/Previous, refresh, Company scoped detail and active status persisted.
- Revoking `company.workforce.manage` removed the search and blocked direct CSV export on the **same originally signed-in Company session**; denial **HTTP307**, no Worker export data.
- No change to production or shared QA branch.

**GREEN raw TAP** `/home/ubuntu/work/.hse-qa-tmp/agency-zero-r36/R36-company-workforce-csv-safe-browser-green.log`, SHA256 `cbb0d56b76c5ff1893d7d11ddbfa80eb4fd90fa21d681f885a909dd0c82d70cf`; `R36.green.receipt.json` in same private directory; exact test source SHA256 `c61a5316be34d7bbcad35eb01b2f8bb2b185c7d6e5459ddf21cd1f906cf19f21`; repaired QA route SHA256 `0f3cd5a0d168bf1218e01d48b85cf8f2bca2e7b15fbc3d4db28bcb10c5c504b8`.

One separate narrow regression `node --test --test-concurrency=1 --test-name-pattern="Strict report payload validation and CSV formula escaping reject unsafe inputs" tests/platform/report-company-generation-runtime.test.mjs` **1/1 PASS exit0**, validating the source safe CSV helper's formula policy. Source TypeScript (`npx tsc --noEmit`), changed-source ESLint, browser test syntax and `git diff --check` all PASS. An unrelated direct `node --test` invocation of `report-delivery-domain.test.mjs` lacks its raw TypeScript import resolver and failed **before tests**, not evidence of an app bug; the loader-backed formula regression above passed.

## Triple discipline assessment — scoped, not release certification

**ENGINEER — QA FIX SCOPED PASS:** Actual authenticated Company export red→green and original search/filter/pagination tests pass; core shared safe encoder reused rather than duplicating behavior. A production build, universal regression and protected staging on an integrated source candidate remain outstanding.

**CYBERSECURITY — QA FIX SCOPED PASS:** Genuine CSV formula injection from Worker display fields demonstrated on original route, neutralized on isolated fix; tenant and role query spoofing/anonymous/revoked access still denied. This is not a whole-system pentest or proof that every CSV endpoint is safe. The exploit is **spreadsheet formula interpretation risk upon opening exported CSV**, not evidence that arbitrary code executed in this test.

**REVIEWER — SCOPED PASS, CANDIDATE DRIFT/RELEASE GATE OPEN:** Original RED exit1, same original workflow GREEN exit0, exact SHA evidence and cross-boundary assertions preserved. The canonical app SHA is intentionally **not changed or re-pinned**; this separate unmerged QA branch has product-code drift and must NOT be described as the original approved full system. No original 218 FULL awards. The source test file's content SHA differs from the archived historic evidence index; post-approved common-SHA integration requires append-only/source-digest reconciliation preserving old case identities/proofs.

## Parallel independent hosted audit, not a pass
Independent full hosted [R35 run 45361516452](https://github.com/itxsam57/hseverify-production-hardening/actions/runs/45361516452) is on separate SHA `e61e69fa0962bd6f8aa5ae9f2bd3a4a203a5ab95` and was **IN_PROGRESS** in `Existing full regression gate cross-check` at R36 test checkpoint. It does not include this R36 fix. Previous full audits 45213941977 and 45229745087 **FAILED** for intermittent `Assurance` columnheader visibility, still under R35 investigation; do not infer green.

**NEXT:** Guarded QA-only commit/push R36 source fix + browser test + report, open separate DRAFT QA PR. Independently integrate reviewed QA fixes into an isolated common staging candidate (not prod), reconcile original 218 source-test identities and rerun complete full regression and real browser/adapter/pentest/recovery gates. If R35 hosted CI reaches terminal, inspect exact `FINAL-AUDIT.json`, `commands.tsv`, full regression log and accessible-header diagnostic. **TECH FULL 0/218 | OWNER TESTING READY NO.**

## Guarded QA review artifact and source-pin control

- Guarded QA source commit a16198479fd18eef07a5ff297a445389c20befb5 pushed; **[draft PR #222](https://github.com/itxsam57/hseverify-production-hardening/pull/222) OPEN**, unmerged, targeting QA review.
- **Post-commit pinned-app control correctly RED**: agency_zero_control.py --check exit **2**, reports committed app source drift specifically src/app/api/company/workers/export/route.ts. Private receipt .autopilot/artifacts/zero-r36-pinned-app-source-drift-expected-red.log SHA256 47ea5f5afd77ab1bbc2483d37a3afd7535cd437dcaa1dfae883c0f91b5a1f9b4. This is an unmerged QA security fix, not authorization to re-pin or waive the original control.
- Next protected QA integration must independently review new application-source delta and original 218 evidence source digest before changing any pinned candidate. No production merge.
