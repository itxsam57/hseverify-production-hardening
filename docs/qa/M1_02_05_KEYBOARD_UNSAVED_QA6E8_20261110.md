# M1.02.05 — actual mobile keyboard and unsaved-form navigation QA (2026-11-10)

**SCOPED LOCAL BROWSER EVIDENCE · M1.02.05 NOT FULLY VERIFIED · FULLY VERIFIED 0/218 · RELEASE NO-GO.**

Code source SHA `6e8f8ffdeff9b7e850fbfb975f0937a7a27ff3a9` (PR #75 source integrated through signed QA merge `71a22ce20f453c0ed2804a1d7cbb672ae164533c`). Isolated worktree `hseverify-m10205-unsaved-20261110` on `qa/verify-m10205-unsaved-focus-20261110`. All real Chromium tests run against disposable, synthetic local Next/PGlite, not final protected staging or real providers.

## Actual user controls and state transitions

- **Worker evidence metadata:** Create real Qualification draft, type unsaved title, verify labelled field can receive focus and a **keyboard Tab moves to a visibly focused control at 320px**.
- Open actual **320px Worker mobile navigation** and click Dashboard while title is dirty; browser confirmation is dismissed, route and exact unsaved text remain. At **390px**, browser Back also triggers one confirmation and dismissal, preserving route and text.
- Return to desktop and verify repeated navigation after reverting a field does **not** produce spurious warnings; a successful Save metadata action clears dirty status and persists exact title after route transitions/reload. Invalid verification URL displays actionable validation without losing unsaved text; canceled navigation preserves it.
- Race/retry: simulate a delayed **client delivery** of a real accepted save response; user edits again while older save is pending. The UI retains newer unsaved text, warns before navigation, and persisted database state reflects the submitted snapshot rather than the newer discarded draft. Accepted leave clears the browser draft without corrupting committed state. This is not a real network/provider outage.
- Run both browser navigation strategies: default Navigation API and forced history fallback, each with the mobile flows above — **2/2 distinct browser cases PASS**. Independent `form-history-fallback.browser.test.mjs` exercises multi-step Back/Forward, `history.go`, Next history state and history-length integrity without silent loss — **1/1 PASS**.

## RED→GREEN evidence

Original signed code test `tests/browser/unsaved-form-navigation.browser.test.mjs` exercised desktop Dashboard links only; it had no real 320px mobile navigation or focus assertions. Deterministic original-source acceptance check failed: `.autopilot/artifacts/M10205_MOBILE_UNSAVED_BASELINE_RED.log`. Expanded real Chromium suites passed on the QA source: `.autopilot/artifacts/M10205_MOBILE_UNSAVED_CHROMIUM_GREEN.log`; independent fallback log `.autopilot/artifacts/M10205_BASELINE_form-history-fallback.log`. This is a **missing test-coverage dimension**, not a reproduced application data-loss exploit. The application source code has not been altered.

Machine-readable `docs/qa/evidence/M1_02_05_QA6E8_LOCAL_RESULTS.tsv` binds logs and exit codes to exact source SHA. Strict TypeScript/lint and CI must be confirmed from actual logs. New GitHub workflow `.github/workflows/m1-02-unsaved-keyboard.yml` runs all three browser cases plus existing Worker/Company accessible form validation with actual Chromium on exact PR SHA, retaining test logs on failure as well. Workflow syntax and contexts passed actionlint v1.7.12 locally, **remote GitHub CI not yet verified**.

## Missing to claim FULLY_VERIFIED

- Entire six-role keyboard-focus/labels/navigation matrix (including Company/Verifier/Assessor/Admin/Root), unsaved input protection on every critical real form, retry/race/refresh/offline and negative direct API abuse on final staging.
- Production OTP/SMS/email/storage/assessment provider delivery, final protected exact release SHA, complete pentest, realistic load/restore and Owner UAT.
- Do not claim full 218 release signoff; project remains **0/218 FULLY VERIFIED, NO-GO**.

**Next:** guarded commit and exact-commit browser rerun, push isolated PR into QA after PR #75, verify new exact-SHA Chromium CI and merge signature; then address remaining M1.02.05 cross-role keyboard/dirty-form and first unfinished M1.03 scenario dimensions.
