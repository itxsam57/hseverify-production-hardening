# M1.02.04 — real six-role mobile/desktop confirmation dialog controls (2026-11-10)

**SCOPED LOCAL UI TEST PASS · M1.02.04 NOT FULLY VERIFIED · FULLY VERIFIED 0/218 · RELEASE NO-GO.**

Verified source base: `9e553a777765101764d28800ea4462700b52f042` (PR #74 exact-source test commit, now included in signed QA merge `380ad9d876aa8d5f99eafd0fb13f5db78d72ffa6`). Isolated worktree `hseverify-m10204-dialog-20261110`, branch `qa/verify-m10204-dialog-20261110`. All browser verification used synthetic users, actual headless Chromium and a disposable local Next/PGlite server; no production provider or protected final staging.

## Actual controls exercised

- Browser test `tests/browser/portal-navigation-responsive.browser.test.mjs` signs in **Worker, Company, Assessor, Verifier, Admin and Root**. Each passes the real mobile sidebar toggle/navigation links at **320 and 390 px**, and desktop sidebar at **1280 px**. All menu tap targets are at least 44 px high; mobile/desktop layouts have no page-wide horizontal overflow or client exceptions.
- The newly expanded test **opens each role's actual Sign out confirmation dialog** at **320, 390 and 1280 px**; validates native open modal and accessible dialog heading, dialog horizontal bounds, keyboard Tab focus trapped inside the dialog, Escape safely closes without ending the session, and re-opening then clicking Cancel also safely closes while retaining the same authorized role/dashboard. No hidden or inert buttons substituted.
- A separate existing six-role real authentication suite already covers the **positive Sign out** path, active session revocation, cross-role login denial and authoritative security/audit state; this focused M1.02.04 test covers the opposite **Escape/Cancel/no session loss** outcomes, not full staged logout re-certification.
- This is targeted responsive dialog/route evidence. Tables and every application form/dialog/transition on final staging still require separate acceptance.

## Recorded RED→GREEN

The unchanged original test in source QA `9e553a7...` **never opened a dialog or tested Escape**. A source-coverage acceptance assertion on the exact baseline failed as intended; log `.autopilot/artifacts/M10204_DIALOG_BASELINE_RED.log`. Expanded actual Chromium test **PASS 1/1**, with 18 role-by-width modal interactions covering opening/keyboard Escape/Cancel (6 roles × 3 widths). Original responsive tests remain intact; verified local log `.autopilot/artifacts/M10204_CHROMIUM_DIALOG_BASEQA.log`. This is a **test coverage gap**, not a demonstrated application vulnerability. No production feature code was modified.

Strict TypeScript, lint and exact committed-SHA CI replay are independently gated; no PASS claimed before their exit logs exist. The existing real Chromium GitHub Actions workflow `.github/workflows/m1-02-header-controls.yml` includes `portal-navigation-responsive.browser.test.mjs` in its path filter and actual browser job; it should rerun the new assertions on the exact pull-request head SHA. All CI and signed merge SHA must be observed before integration.

## Still missing for FULLY_VERIFIED

- Exhaustive real UI table/forms/dialog/route transitions and keyboard on 320/390/desktop for all six roles, including creation, update, rejection, retry, close/interrupt and receiving-side state.
- Final protected same-SHA staging, real configured providers and object storage/payment/notification dependencies, authenticated API/tenant abuse and complete penetration testing, load/restore, owner acceptance. The QA branch has previously been reported **unprotected**.
- The frozen ledger remains **0/218 FULLY_VERIFIED**. M1.02.04 stays IN_PROGRESS/not fully verified. Do not upgrade based on one local Chromium case.

**NEXT:** Guarded commit, rerun responsive Chromium suite on exact committed SHA, push PR to active QA after PR #74, verify existing M1.02 header Chromium CI plus all other checks and signed merge. Then test one representative real responsive table/form workflow with keyboard and route transition; preserve source receipt and external blockers.
