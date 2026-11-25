# ZERO-R40 — Native Company workforce table header accessibility repair

**One original related scenario:** M2.13.04 (credential validity lifecycle, Company directory). **Frozen app SHA:** 7ff30ea140a5145e5d5ba761f7c7aef24c895269; R40 is an isolated **proposed application source change** and must NOT be counted as verified on frozen original SHA. **QA base:** ec16ed7eade2259fefe72eb01a6fb33a4acf8f1d. Captured 2026-11-24T10:50:02.267198+00:00 UTC. No new original ID, 218 ledger rewrite, launch approval or change to production/staging.

## Actual hosted red inherited from R39
The exact prior R35 hosted full independent audit [run 45361516452](https://github.com/itxsam57/hseverify-production-hardening/actions/runs/45361516452) on e61e69fa had **FINAL-AUDIT verdict DEFECTS_FOUND**; critical1/high0, only one failed generic full-regression cross-check. In the original credential-validity Chromium test, the Company Workers table HTTP200 contained a physically visible native `<th>Assurance</th>`, yet `getByRole('columnheader')` count was **0**, even at 1440px. The accessibility snapshot exposed all six native headers as `cell`. The trace did NOT prove a missing API row, missing header text, DOM visibility failure, or security exploit. Source snippet had no header scopes. R39 preserved exact hosted artifact/log checksums separately.

## Narrow real fix
- In `src/app/company/(portal)/workers/page.tsx` only, specify `scope="col"` on all six existing `<th>` elements (Worker, Worker ID, Site/department, Link, Assurance, Action). No test assertion or timeout was weakened, no CSS/responsive hiding hack, no server/query/auth/API/PDF behavior changed.
- Before source edit, original R35 local clean Chromium also mapped bare `<th>` to header roles; Chrome interpretation varies between local and hosted. Thus R40 scope is standards-based semantic reinforcement, **not yet a proven hosted root fix**. Original mandatory accessible role check remains unchanged.

## Exact executed R40 verification — max one original workflow
- Local source ESLint **exit0**, TypeScript `tsc --noEmit --incremental false` **exit0**, git diff --check **exit0**; original 218 plan `agency_zero_control.py --check` **PASS** at local precommit QA base.
- First original 1/1 real Chromium attempt **FAIL 0/1** at fixture startup **before any browser workflow**. Cause proven by log: Next Turbopack rejected `node_modules` symbolic link to other worktree (outside hermetic root), missing `next/package.json`. **ENVIRONMENT_SETUP_DEFECT, not product defect**; raw SHA256 `e20ebc967a4bab6ef8cb3d53a00646d4cd12bddcc56c8cbe24a517336fa4567a`.
- Fixed only isolated worktree dependencies by physically copying the exact locked R35 `node_modules` (~537MB), untouched source/test code. One permitted retry of **unchanged original credential-validity.browser.test.mjs** **PASS 1/1, fail0, exit0**, actual 390px `getByRole('columnheader', name 'Assurance')` roleCount1, native/role visible; real Worker/Company assurance statuses and receiving roles, public API and PDF checked. Raw TAP SHA256 **`c9fc9a36b695427068a1bee8d77b6d2fc33dadba5656699b210882a0e5691888`**. A prior R35 same original case local pass cannot supersede hosted red; R40 red/green only tests scoped new semantics.
- Exact edited JSX SHA256 **`f1e46e71f906ef721a1afaa1ca77d04856dcc06fb6ad1a752c033ce8913b606a`**, git blob `5f6e8f8a9d772aa95af36e4441d186654122974e`. Source bytes must match the guarded commit and any hosted retest.

## Three disciplines
- ENGINEER: **SCOPED PASS** R40 local one original browser workflow, TypeScript, ESLint and minimal JSX diff; first broken setup explained by Next hermetic module resolver.
- CYBERSECURITY: **INCOMPLETE for scenario**; changed only native header semantics, prior auth/Company/Public/PDF assertions remain unchanged and pass in scoped case; full cross-tenant/authenticated penetration testing not established.
- REVIEWER: **SCOPED PASS of local evidence; HOSTED CI STILL RED** until exact new code SHA audit passes. No TECH FULL award. Reviewer is AI-based/source/log review, not an outside licensed certification.

## Evidence and next
Private raw logs reside `/home/ubuntu/work/.hse-qa-tmp/agency-zero-r40/`. DO NOT publish raw synthetic credentials; only SHA fingerprints in repository. Candidate SHA7ff remains pinned elsewhere, so this unmerged proposed product patch **requires explicit candidate integration/repin and affected scenario revalidation**, preserving old receipts.

**NEXT exact:** V4 guard commit/push isolated R40 source patch and report, open **draft PR targeting R35 QA** without merge; review/apply candidate repin only after integration approval, then re-execute the original full credential browser and hosted independent full audit on the exact new app/config SHA. If still red, inspect AX tree with `scope`, and treat as host-specific accessibility root defect. Continue unrelated original batches <=5. **TECH FULL 0/218, OWNER TESTING READY NO.**

## Post-commit app-source pin drift — expected governance gate RED

- V4 guarded QA-only source/document commit **`5ae0d3f0dae690ef46f5b1e76e54e9829f8c1ebb`** preserves tested JSX Git blob `5f6e8f8a9d772aa95af36e4441d186654122974e`.
- Exact postcommit `python3 scripts/agency_zero_control.py --check` returned **exit2**, not PASS: `Pinned application candidate has runtime drift; retarget candidate and selectively recheck: src/app/company/(portal)/workers/page.tsx`. This is an *expected correctly enforced source pin guard*, not permission to change the 218 statuses or claim the new code source was certified.
- R40 fix is a **draft-source proposal only** until protected candidate repin and selective regression happen. Do not dispatch a hosted full audit expecting a valid candidate attestation while the source pin rejects it; preserve the original R35 hosted RED.
