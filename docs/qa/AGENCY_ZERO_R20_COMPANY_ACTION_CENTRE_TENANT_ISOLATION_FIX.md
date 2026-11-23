# ZERO-R20 — Two-tenant Company Action Centre BOLA and 320px responsive overflow

**Canonical HSE app source remains frozen** at `7ff30ea140a5145e5d5ba761f7c7aef24c895269`. **TECH FULL 0/218**, OWNER TESTING READY NO. One new related R20 M3.04.03/M3.04.05 authenticated Company security/UI workflow, <=5 independently scheduled test cases. This separate **QA-only fix branch** `qa/zero-r20-action-centre-table-scroll-20261123` is based on prior QA evidence head `752d4cfc37f9f4e82b1cab9bc08cfef6783af70e`. It **modifies application source only within a disposable isolated worktree**, is not merged and does not repin the canonical app. No production/shared-stage/provider writes.

## Original candidate: confirmed responsive defect, not a passing scenario

- New real Chromium synthetic two-tenant test uses two signed-in distinct Company owners, verified Company membership/role/MFA, A's two owned orders/cases and B's one order/case/overdue action. The first attempt failed fixture creation: missing invitation ID for invitation-sourced `company_worker_links`, SQL 23514. **TEST FIXTURE DEFECT**; left source app unchanged and used an authoritative `permanent_worker_id` link afterward. Private original log SHA256 `225103607f42d6e4ef904cc7a7cda8b37c95d18745fcae62f9a368b94f69ff3c`.
- With corrected fixture on **pinned source**, real Company A Chromium at **320px** gave `document.documentElement.clientWidth=320`, `scrollWidth=459` (139px overflow). Target `TENANT_A_ONLY_CRANE_CONTROL` is a synthetic but valid long, unbroken competency label. **ACTUAL UI FAILURE**; no cross-tenant claim for the incomplete initial flow. First browser red SHA256 `af1d45cd97c8dc47f4c05c40b4e903b9942c0a773dcf63c2bde4ebaf0eadceba`.
- Diagnostic repeat confirmed exact offenders: `section.detail-card > div.table-wrap > table`; `div.table-wrap` had `overflow-x: visible`, `scrollWidth=445`, root page `scrollWidth=459`. Private log SHA256 `324c43263add70f4bfc9b18a890f1cd3614c73c2916f2f6c69b3d966251200ae`, saved synthetic screenshot `R20-overflow-320.png` SHA256 `d774a072282794fe8eb80257c1e876caddc833083b3385b25467f0847f807991`.

## Root-cause correction tested ONLY in separate QA worktree

Existing `src/app/layout-containment.css` already defines `.table-scroll { width:100%;min-width:0;max-width:100%;overflow-x:auto; overscroll-behavior-inline:contain; }`, while `.table-wrap` did not have equivalent sizing/scroll containment. Two `className="table-wrap"` occurrences in `src/components/company/company-action-centre-analytics.tsx` (readiness and competency tables) were replaced with **`className="table-scroll"`**, no layout rules weakened, no hiding/cutting off important text, no API/DB/authorization behavior changed.

**Real browser patched candidate SCOPED PASS 1/1, exit0**, private raw `/home/ubuntu/work/.hse-qa-tmp/agency-zero-r20/r20-isolated-ui-patch-test.log` SHA256 `d235771c8cb7738fd4b24379e80868d1c03cc8a124c99c84c8c1409c37eb1bdb`. The new exact test now verifies:
- Company A (2 own orders / 2 cases / 0 overdue) and B (1 own order / 1 case / 1 overdue) after independent password/MFA authentications in a local disposable PGlite+Next.js+Chromium stack
- 320/390/1440px action-centre layouts with no horizontal page overflow and no browser runtime errors for both companies
- A and B cannot see the other company's unique competency target, order ID or case ID in HTML; forging `?tenantId=<foreign tenant>` does not override trusted session scope
- Copied direct foreign `/company/assurance-orders/<order ID>` requests not HTTP 200 and do not leak the target, anonymous private Action Centre denied
- Synthetic authoritative DB has exactly 2 A Cases and 1 B Case.

Test source after minor unused-variable lint cleanup: `tests/browser/m3-04-company-action-centre-tenant-isolation.browser.test.mjs` SHA256 `2326e0970530cf6e9ef9f7aa037151b6b734c2b3ebb7864441942d5dcc7bf7fd`; patched component SHA256 `4000a88d3b44d671d329c04252b07a9e80b993cfe8bebc74b04d05589be70f31`. In final combined rerun the **new R20 test PASSED again**, while a separate older R18 regression FAILED; see below. Code gates `npx tsc --noEmit` **PASS**, `npx eslint <changed component and new browser test>` **0 warnings/errors**, `git diff --check` PASS, `npm run qa:preflight-218` PASS, `agency_zero_control.py --check` preserves 218/37/58 metadata. Do not represent as a production release gate.

## Separate regression blocker retained, NOT masked

Old checked-in `tests/browser/m3-04-company-action-centre-mixed-status.browser.test.mjs` initial Company signed-in UI and authoritative DB pre/post outcomes passed; its second login after cold Next/PGlite restart timed out awaiting `/company/dashboard` **twice**, after 20s on both runs. This is **R18 regression FAIL / cause unconfirmed**, not proof the table styling caused it. Potential same-TOTP-counter replay during close-together logins is a *hypothesis only*. Preserve logs:
- Combined new R20 PASS / old R18 FAIL: `r20-final-two-browser.log` SHA256 `8c1f88c6cfbebd532f43c764492301e7e2a5e9e316cdf6a166d2df26be584650`.
- Single old R18 diagnostic repeat FAIL: `r20-r18-cold-login-retry.log` SHA256 `86df7fe5ef03a1bcbf234e045af3dc36851549e347c145381d6cebe6366f7ec4`.
No code test assertion relaxed, no TOTP anti-replay weakened; leave exact blocker for a separate bounded investigation.

## Three disciplines and independent audit

**ENGINEER:** confirmed actual root DOM overflow and minimal existing utility class fix; exact real Chromium dual-company 1/1 patched PASS; isolated old R18 regression still RED.

**CYBERSECURITY:** patched real two-tenant UI/HTTP tests show foreign order/case/target denial, forged tenant query ignored, signed-out denied. Targeted positive/negative **SCOPED PASS** only. No complete independent pentest or production adapter test.

**REVIEWER:** source, TAP, private screenshot, two red histories, current source hashes and UI assertions cross-checked. Cannot award original M3.04 technical FULL until common regressions, production-compatible DB, independent manual/security role reviews and candidate repin. No claims of an external accredited agency.

**Separate corrected hosted audit:** [45178421779](https://github.com/itxsam57/hseverify-production-hardening/actions/runs/45178421779), exact test-only SHA `8e8ee7921db306f2fadcfdcd53e15103ddcf6cff`, finished **FAIL**. Its sole audit critical is `existing_full_regression_crosscheck` exit1: `tests/platform/written-review-assignment-runtime.test.mjs` first test rollback attempted 0121 appeal notification down on migration stack with later 0130 wrapper, rejected by SQL drift guard. 81/82 in that suite passed; not a proven exploitable security vulnerability. Full hosted FINAL-AUDIT.json SHA256 `cc46c6bf51df3081553023146d380e3ac5c0a95f4620bc81471cb3d948e39b4c`, full regression log SHA256 `02786312ab2d908c7e842b414e7bf2883a02d81402dba87c52525572f04c4537`. This needs separately guarded QA test-fixture rollback correction, without relaxing SQL guard; do not misreport CI as green. Older run 45112527041 attempt 2 status to be rechecked.

**NEXT:** Guarded QA-only draft PR for two-line table containment plus added reproducible browser test; **do not merge or repin original source** until dependencies and R18 regression are reviewed. Separately address hosted written-assignment migration 0130 rollback issue. Continue original 218 scenario batches independently (<=5 cases), preserve 0/218 tech numerator.
