# M1.02.04 — real 320px dense forms/tables across six roles (scoped)

**Status: current software scoped PASS; NOT FULLY VERIFIED; RELEASE NO-GO.** Frozen Masterplan scenario M1.02.04 is **Responsive desktop/mobile forms/tables/dialogs and route transitions**. This is not comprehensive independent pentest, 117-page final UI audit, real provider, protected-stage signoff or Owner UAT.

## Baseline, previous evidence reused, and why these checks were necessary

- Signed QA baseline before work: `48be135269191ce0971be5648efc42a67b8875ad` (**32/32 exact SHA GitHub Actions SUCCESS**, PR104 signed). All current roles/workflows on the QA branch remain release **NO-GO** until final 218/218.
- **Reuse** direct known green `tests/browser/portal-navigation-responsive.browser.test.mjs#6c01fac2da3d4244`, actual six-role navigation 320/390 including 320/390/1280 native sign-out dialog, Cancel/Escape focus trap, retained auth; `tests/browser/all-role-ui-layout.browser.test.mjs#88d4e0c2ca98638a`, actual ~49 portal route pages 390/1440 with real full-page screenshots, overflow/overlap/button clipping, and notification/mobile menu checks; `tests/browser/consumer-validation.browser.test.mjs` 320/390/1365 real public form labels/focus/validation. Previous passes retained, not rerun as new distinct tests. Re-ran the **existing all-role-layout named case only** because its source was extended for a genuine new mobile gap.
- **Missing coverage RED (not a product bug):** this broad existing portal test had **NO** 320px dense page-content check, while the separate 320 navigation/dialog test covers only dashboards/shell/modal. Explicit source-gap test `.autopilot/artifacts/M10204_320_DENSE_GAP_EXPECTED_RED.log` exit1 (required marker absent). No bad button/table assertion at 320 was assumed before browser execution.

## New actual Chromium assertions and evidence

Single actual `node --test tests/browser/all-role-ui-layout.browser.test.mjs` on existing disposable local PGlite and six synthetic valid accounts, with role-specific actual login/MFA and original 390/1440 page checks preserved, extended the **SAME** existing case with narrow **320x844** viewport on **16 real data-facing routes**:

| Role | 320px forms/table routes |
| --- | --- |
| Worker | `/worker/profile`, `/worker/identity`, `/worker/evidence`, `/worker/passport` |
| Company | `/company/team`, `/company/assurance-orders`, `/company/billing`, `/company/reports` |
| Verifier | `/verifier/reviews`, `/verifier/reviews/scoring` |
| Assessor | `/assessor/interviews` |
| Admin | `/admin/company-verifications`, `/admin/decisions`, `/admin/operations`, `/admin/question-bank` |
| Root | `/root/staff` |

For each targeted route, real browser evaluated and asserted **no document horizontal overflow, offscreen visible controls, overlapping visible controls, or clipped buttons/links/summary labels**. For any `.table-scroll` whose contents overflow, proved CSS `overflow-x:auto/scroll` and actual programmatic horizontal scroll movement, instead of trusting hidden body overflow. Captured 16 real full-page screenshots in `artifacts/all-role-ui-layout/narrow320/`, alongside original desktop/mobile captures. No real user data or shared workstation service modified. Actual test command **1/1 PASS** (~127s) with `TEST_EXIT=0`, log `.autopilot/artifacts/M10204_REAL_320_DENSE_SIX_ROLE_CHROMIUM.log`, and all **16** narrow screenshots created. **No new application CSS patch was required for these observed route states.**

## Scope limits, original counting and next action

- The fixture has synthetically valid accounts but not realistic populated records in **every** table or every possible dialog; these are **representative current page states only**. Additional populated-row, keyboard tab/scroll, 200% zoom, interruption and full-staging browser checks still required. The source case stays the same existing static identity; one re-execution does **not** increase 1,392 historical passing source cases or the 4,975 final-stage certified count. New scoped evidence relates to `SCENARIO:M1.02.04:01` controls and `:02` responsive layout, not a whole compound plan slot or scenario.
- Original counters still **FULLY VERIFIED 0/218, LEFT218**; historic source previously GREEN **1,392/1,566**, historical scoped **216/218 partial only**, planned **693/4,975 previously linked PARTIAL**, 54 uncertain, 4,228 unlinked, protected-stage final **0/4,975**. Full independently signed pentest INCOMPLETE (2,008 preliminary candidate attack-family slots; exact independent executed unknown; HIGH/CRITICAL unknown), 10 known external blockers, **RELEASE NO-GO**.
- Two source-provenance SHA256 fields in `MASTERPLAN_218_EXECUTED_TESTS.json` and dependent original 216 legacy map refreshed only because original test file changed; no historical test ID/pass count or 316 old observations altered.
- **NEXT:** guarded commit/push PR against canonical QA from signed `48be1352`, require exact-head 4975 integrity and real six-role layout CI on Ubuntu runtime, signed canonical QA merge + all exact merged SHA workflows. Then move to **M1.02.05 Keyboard focus/navigation/labels and unsaved-input protection** after reading its prior green tests, to add only missing live focus/unsaved cross-role behavior. Full final stage and pentest/Owner UAT remain mandatory.
