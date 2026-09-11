# Current-Head Consumer Audit Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the independent full-system audit into a production-realistic, permanent regression baseline, fix only defects reproduced with valid consumer/business state, and leave proven working behavior unchanged.

**Architecture:** Keep the audit harness isolated from application behavior. First repair fixture validity and noisy classification inside the independent audit scripts, then rerun against exact `main` lineage. Only findings reproduced with production-valid registrations, sessions, tenant state, and verification prerequisites become application bugs. Permanent locks are added around independently proven registration, MFA, portal isolation, consumer-route rendering, mobile layout, public privacy, assessment secrecy, and migration/history integrity before M2.08 starts.

**Tech Stack:** Next.js 16.2.12, React 19.2.8, TypeScript, Node 24 CI, PGlite, Playwright Chromium, GitHub Actions.

**Spec:** Owner instruction recorded in project context plus `.engineering/M2.07-ACCEPTANCE.md` and the current independent audit evidence from run `33468430468`, artifact `9785890754`, digest `sha256:c6ab1cf1137dedb56d9fb43ce1d3fb5f2d5e68228e1902abecdc932316da89cd`.

## Global Constraints

- Baseline application commit is `758c939c34909f26ce5d89b5039f490cf898d5f4`.
- Do not change already proven working behavior merely to satisfy the audit harness.
- Do not delete any dead/extra-code candidate until repository-wide use, tests, scripts, runtime entry points, and milestone contracts are checked.
- Every confirmed application defect is fixed test-first: RED reproduction, minimal root-cause change, GREEN targeted test, then full regression.
- Role isolation, tenant isolation, assessment answer secrecy, audit history integrity, append-only history, and public non-enumeration are security invariants and may not be weakened.
- M2.08 does not start until this audit baseline is classified, repaired, permanently locked, and fully green.

---

### Task 1: Make independent audit fixtures production-valid

**Files:**
- Modify: `scripts/independent-audit-seed.mjs`
- Modify: `scripts/independent-audit-browser.mjs`
- Test: `.github/workflows/independent-full-system-audit.yml`

**Interfaces:**
- Consumes: the same database schema and auth sandbox used by run `33468430468`.
- Produces: seeded/fresh Worker and Company states that satisfy the same invariants as real registration flows before protected route sweeps begin.

- [ ] **Step 1: Write the failing audit assertion**

Add explicit fixture assertions before role route sweeps: an active seeded Worker used for identity routes must have verified email and phone timestamps; a Company used for profile routes must own a verification case/current version; a Company used for workforce routes must have an active tenant and a `verified` verification case. Make the harness fail with a fixture error before browsing when any invariant is absent.

- [ ] **Step 2: Run the independent audit and verify the old fixture fails**

Run the workflow on the audit branch. Expected: fixture validation fails before the three previously observed HTTP 500 routes, proving the old seed was not a valid production business state.

- [ ] **Step 3: Create production-realistic fixture state**

Update the seed so Worker contact verification and Company verification records are created consistently with migration constraints, or reuse the newly registered Worker/Company accounts created through the real registration UI and promote only the workforce-test Company through the normal verification data model. Do not bypass authorization checks in application code.

- [ ] **Step 4: Make isolation diagnostics target-specific**

In `scripts/independent-audit-browser.mjs`, record each attempted source role → target role dashboard transition before navigation and include the exact target in failures. Treat a timeout as a failure only after capturing final URL, response status if available, and browser/server evidence.

- [ ] **Step 5: Rerun and require no fixture-invalid HTTP 500s**

Expected: `/worker/identity`, `/company/settings/profile`, and `/company/invitations` are tested with valid corresponding state. Any remaining 500 is promoted to a real application defect; disappearance under valid state closes the old finding as an invalid-fixture audit defect.

### Task 2: Remove scanner false positives without weakening real secrecy checks

**Files:**
- Modify: `scripts/independent-audit-static.mjs`
- Modify: `scripts/independent-audit-browser.mjs`
- Modify: `scripts/independent-audit-finalize.mjs`

**Interfaces:**
- Consumes: current production source, route inventory, rendered HTML.
- Produces: findings whose severity reflects actual exploitability/workability rather than keyword presence.

- [ ] **Step 1: Add classifier assertions for known false positives**

Verify `package.json` contains `build`, `typecheck`, and `lint`; verify registration strings such as `"Create a password."` and `"The passwords do not match."` are validation copy rather than embedded credentials; verify timestamp fields such as `createdAt`, `updatedAt`, and `submittedAt` are not automatically classified as secrets.

- [ ] **Step 2: Keep real browser secrecy checks context-aware**

Forbid assessment answer/model-answer/rubric/blueprint internals from Worker, Company, public, assessor, and verifier surfaces unless the product contract explicitly requires that role. Do not flag admin authoring pages merely because administrators legitimately edit `answerKey`, `rubric`, or blueprint identifiers. Continue to flag hashes, encrypted secrets, session/token material, and unauthorized answer-key leakage everywhere.

- [ ] **Step 3: Reclassify dead exports as candidates only**

The scanner must label an export as a cleanup candidate only after noting that `src/` textual reference absence is insufficient proof. It must never produce a deletion instruction from that signal.

- [ ] **Step 4: Rerun classifier checks**

Expected: the bogus tooling/hard-coded-secret/client-boundary highs disappear while genuine secret leakage would still fail the audit.

### Task 3: Reconcile rollback semantics with migration ownership

**Files:**
- Modify only if evidence requires it: `scripts/independent-audit-database.mjs`
- Inspect: `database/migrations/*.up.sql`
- Inspect: `database/migrations/*.down.sql`
- Test: existing migration/rollback tests invoked by `verify:full`

**Interfaces:**
- Consumes: all 42 up/down migration pairs and migration history behavior.
- Produces: an explicit classification of the 51 tables left after the harness down-stack attempt.

- [ ] **Step 1: Prove what the rollback command is supposed to reverse**

Trace `scripts/db-rollback.mjs` and migration tests. Record whether the supported contract is one-step rollback, milestone rollback, or total schema teardown.

- [ ] **Step 2: Compare every leftover table to its owning migration/down script**

For each of the 51 reported tables, identify the creating migration and whether its paired down script intentionally preserves the table or whether the harness did not actually execute that down migration.

- [ ] **Step 3: Promote only contract violations**

If supported rollback semantics require a table to disappear and its down path does not remove it, write a RED migration test before changing SQL. If total teardown is not a supported contract, correct the audit wording rather than altering migrations.

- [ ] **Step 4: Rerun full migration stack, rollback contract, reapply, append-only history, and assessment-answer immutability checks**

Expected: all existing integrity checks remain green and the rollback ledger has no ambiguous PASS/leftover contradiction.

### Task 4: Verify all 53 dead/extra-code candidates without deleting working boundaries

**Files:**
- Inspect each path in the audit `dead-export-candidate` ledger.
- Create: `.engineering/CURRENT-HEAD-AUDIT-CLEANUP-CLASSIFICATION.md`

**Interfaces:**
- Consumes: repository source, tests, scripts, route actions, runtime compilers, workflow entry points, milestone contracts.
- Produces: per-candidate status `used`, `test/runtime boundary`, `future-contract boundary`, or `proven unused` with evidence.

- [ ] **Step 1: Search beyond `src/` for every candidate**

Check tests, scripts, workflows, dynamic/server-action references, runtime compile entry files, and exported contract use. In particular, do not delete server actions merely because a framework binding is not represented by a simple text import.

- [ ] **Step 2: Record evidence per candidate**

For each candidate, state the exact reason it is retained or the exact proof it is unused. No deletion occurs in this task.

- [ ] **Step 3: Cross-check full regression before any cleanup proposal**

Run `npm run verify:full`. A candidate may only move to `proven unused` if its removal would not violate a current or upcoming contract and repository-wide evidence supports that conclusion.

### Task 5: Add permanent current-head regression locks

**Files:**
- Create/modify targeted platform/browser regression tests following existing repository conventions.
- Modify `scripts/run-engineering-gate.mjs` or its invoked test inventory only if needed to make the new locks part of `verify:full`.

**Interfaces:**
- Consumes: independently proven behavior from the corrected audit.
- Produces: permanent executable protection for the frozen baseline.

- [ ] **Step 1: Lock fresh Worker registration and persistence**

Test full registration, email OTP, phone OTP, sign-in, persisted profile, and the first valid protected Worker pages.

- [ ] **Step 2: Lock Company registration and MFA**

Test full Company registration, email OTP, TOTP activation/sign-in, pending Company profile availability, and verified-only workforce gating.

- [ ] **Step 3: Lock six-role portal isolation**

For Worker, Company, assessor, verifier, admin, and root sessions, attempt every other dashboard and assert the session never enters the foreign portal. Include the source→target pair in every assertion.

- [ ] **Step 4: Lock consumer route workability and mobile layout**

Sweep all static routes in signed-out and valid-role states; fail on HTTP 500, browser page errors, broken visible copy, inaccessible critical controls, or horizontal overflow beyond the agreed tolerance.

- [ ] **Step 5: Lock public privacy and assessment secrecy**

Assert unknown public verification identifiers do not enumerate records and assert unauthorized/public/Worker-facing HTML never contains answer keys, model answers, rubric internals, secret hashes, encrypted secrets, or token/session material.

- [ ] **Step 6: Lock migration/history integrity**

Keep fresh migration application, supported rollback/reapply, append-only history triggers, primary-key rules, credential/session uniqueness, audit action constraints, and committed assessment-answer immutability in the permanent gate.

### Task 6: Fix only defects reproduced by the corrected audit

**Files:**
- Modify only the production files implicated by a corrected, production-valid RED test.
- Test: the new targeted regression test plus all existing affected suites.

**Interfaces:**
- Consumes: corrected audit evidence and permanent RED tests.
- Produces: minimal root-cause fixes with unchanged security boundaries.

- [ ] **Step 1: For each reproduced defect, write/retain the RED test first**

Expected: the test fails for the precise consumer-visible/security behavior, not a scanner heuristic.

- [ ] **Step 2: Implement the smallest root-cause fix**

Do not catch-and-ignore authorization failures, fabricate missing business records in view code, relax tenant/role gates, or serialize private server data merely to make a page render.

- [ ] **Step 3: Run targeted GREEN verification**

Run the smallest relevant test command and confirm the original failure is gone.

- [ ] **Step 4: Run the frozen-baseline regression set**

Confirm registration, MFA, role isolation, consumer routes, mobile layout, privacy, assessment secrecy, migrations/history, typecheck, lint, production build, dependency audit, and `verify:full` remain green.

### Task 7: Seal audit closure before M2.08

**Files:**
- Create: `.engineering/CURRENT-HEAD-AUDIT-ACCEPTANCE.md`
- Update: `.engineering/CONTINUATION.json`

**Interfaces:**
- Consumes: corrected independent audit run, permanent regression gate, cleanup classification, exact final commit SHA.
- Produces: immutable handoff evidence and the next allowed milestone pointer.

- [ ] **Step 1: Record exact run IDs, artifact IDs, SHA256 digests, commit SHAs, and classified findings**

Separate confirmed product defects, fixed defects, audit-harness defects/false positives, retained cleanup candidates, and proven unused code.

- [ ] **Step 2: Require exact-head full verification**

Do not mark acceptance until all required checks are green against the same final head.

- [ ] **Step 3: Merge with expected-head protection and verify post-merge main**

After merge, confirm `main` contains the accepted head and rerun the required post-merge gate.

- [ ] **Step 4: Only then advance continuation to M2.08**

M2.08 begins on top of the frozen, independently audited baseline; it does not rewrite the accepted features.