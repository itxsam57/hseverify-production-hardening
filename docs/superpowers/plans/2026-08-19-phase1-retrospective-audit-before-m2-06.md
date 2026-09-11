# Phase 1 Retrospective Audit Before M2.06–M2.10 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Use superpowers:systematic-debugging for every red finding, superpowers:test-driven-development before product fixes, superpowers:requesting-code-review before Gatekeeper, and superpowers:verification-before-completion before any acceptance/merge claim.

**Goal:** Re-prove every completed HSE Verify brick M1.01–M2.05 against its real product purpose, UX/workflow and correctness-under-load before resuming M2.06 and then building M2.07–M2.10 sequentially.

**Architecture:** Keep GitHub as the source of truth and treat old validation claims as historical evidence only. Build one retrospective evidence matrix, extend the existing Playwright real-browser gate to cover the missing completed user journeys, add a correctness-under-concurrency performance audit, repair only reproduced foundation defects, then issue a separate audit Gatekeeper verdict. The existing M2.06 Task 3 RED remains paused until audit acceptance.

**Tech Stack:** Next.js 16.2.12, React 19.2.8, TypeScript, PGlite/Postgres-compatible migrations, Node test runner, Playwright 1.55.0 Chromium in GitHub Actions, existing Engineering verification gate.

**Spec:** `.engineering/PRE-M2.06-AUDIT-WORK-CONTRACT.md` and the canonical Phase 1 master specification.

## Global Constraints

- Audit completed bricks M1.01 through M2.05; do not skip foundation bricks because later milestones passed.
- GitHub repo/branch is canonical; historical Version-10 deployment claims are not current proof.
- Every visible completed control must have a real backend effect and server-side authorization.
- Real user-facing workflows require real Chromium evidence, not only source-text or repository tests.
- M2.05 ends at server-side form generation/safe delivery; candidate attempt runtime belongs to M2.07 and must not be backfilled during audit.
- M2.06 Task 3 eligibility production code remains paused until audit Gatekeeper ACCEPT.
- No M2.07–M2.10 production implementation before the audit is accepted.
- Fix only reproduced root causes; no speculative refactors.
- Record `.engineering/CONTINUATION.json` after every meaningful audit/fix cycle.

---

### Task 1: Build the retrospective evidence matrix and coverage inventory

**Files:**
- Create: `.engineering/PRE-M2.06-AUDIT-EVIDENCE.md`
- Read: `package.json`
- Read: `.github/workflows/hard-browser-qa.yml`
- Read: `.github/workflows/worker-foundation-ci.yml`
- Read: `.github/workflows/m1-10-targeted-ci.yml`
- Read: `.github/workflows/m1-11-targeted-ci.yml`
- Read: `.github/workflows/m1-12-targeted-ci.yml`
- Read: `.github/workflows/m2-01-targeted-ci.yml`
- Read: `.github/workflows/m2-02-targeted-ci.yml`
- Read: `.github/workflows/m2-03-targeted-ci.yml`
- Read: `.github/workflows/m2-04-targeted-ci.yml`
- Read: `.github/workflows/m2-05-targeted.yml`
- Read: `.github/workflows/m2-05-browser.yml`
- Read: `scripts/hard-browser-qa.mjs`

**Interfaces:**
- Consumes: canonical brick completion requirements M1.01–M2.05.
- Produces: one audit row per brick with purpose, code/schema, security, UI, workflow, history/recovery, concurrency/performance, regression and verdict.

- [ ] **Step 1: Inventory existing permanent checks and browser checkpoints**

Map each npm script/workflow/browser checkpoint to exactly one or more M1.01–M2.05 purpose requirements. Do not mark a UI/workflow requirement proven when the evidence only asserts file contents or route existence.

- [ ] **Step 2: Write the evidence matrix**

Create `.engineering/PRE-M2.06-AUDIT-EVIDENCE.md` with rows M1.01–M2.05 and status values `PROVEN`, `PARTIAL`, `MISSING`, `N/A`, `DEFECT`. Include exact workflow/run/artifact identifiers where known.

- [ ] **Step 3: Identify browser coverage gaps**

At minimum, verify whether current Chromium covers Worker registration/profile/identity/evidence, Company registration/verification/sites/team/invitations, public verification, Assurance Order/Case, evidence document preview, M2.03/M2.04/M2.05 Admin paths, refresh stability and representative mobile layouts.

- [ ] **Step 4: Commit the audit ledger**

Commit only the evidence document and update `.engineering/CONTINUATION.json` to `AUDITING_FOUNDATIONS` with the exact gap list.

---

### Task 2: Expand real Chromium QA to the missing completed workflows

**Files:**
- Modify: `scripts/hard-browser-qa.mjs`
- Modify: `.github/workflows/hard-browser-qa.yml` only if artifact/environment wiring is required
- Create: `tests/platform/hard-browser-audit-contract.test.mjs`
- Modify: `.engineering/PRE-M2.06-AUDIT-EVIDENCE.md`

**Interfaces:**
- Consumes: existing sandbox Root/staff enrollment helpers, real Next.js application, clean PGlite database.
- Produces: browser checkpoints/screenshots/results proving completed user journeys and refresh/mobile behavior.

- [ ] **Step 1: Write a failing browser-audit coverage contract**

The contract must assert named checkpoints exist for:
`Worker registration/contact verification`, `Worker profile and identity persistence`, `Worker evidence/history`, `Company registration/verification`, `Company sites departments team`, `Company worker invitation/code`, `Public verification safe projection`, `M2.01 Assurance Order and Case`, `M2.02 evidence preview/review refresh`, `M2.03 effective policy`, `M2.04 question lifecycle`, `M2.05 blueprint lifecycle`, and `representative mobile portal layouts`.

Run it and confirm RED because current `scripts/hard-browser-qa.mjs` lacks several names.

- [ ] **Step 2: Reuse working repository enrollment/auth patterns**

Read existing Worker/Company sandbox registration helpers/routes and existing service/browser tests completely before adding interactions. Use real visible labels/buttons; do not seed browser-owned state directly when the UI is the behavior under audit.

- [ ] **Step 3: Add Worker journey checkpoints**

Exercise Worker registration/contact sandbox verification, login, profile/identity route transitions, refresh persistence, and evidence creation/upload path. For evidence history, create/revise/end through visible UI where current completed surface supports it and assert prior history remains visible or otherwise backend-verifiable without deletion.

- [ ] **Step 4: Add Company journey checkpoints**

Exercise Company registration/verification, sites/departments/team controls, Worker invitation/company-code route, and representative workforce navigation. Assert tenant/role isolation and reload persistence.

- [ ] **Step 5: Add public verification and Assurance Order checkpoints**

Exercise safe unknown-ID/public result behavior and a Company Assurance Order workflow to the furthest valid completed state using current prerequisites. Assert navigation never requires manual refresh and case/action state matches server result.

- [ ] **Step 6: Strengthen verifier review workflow**

Create or reuse a real review task with candidate/evidence identity, navigate from queue to detail/preview, refresh, and prove required Worker/file information remains accessible while copied/unassigned IDs remain non-enumerating.

- [ ] **Step 7: Retain M2.03–M2.05 admin workflows**

Keep framework/policy and question lifecycle; ensure M2.05 blueprint create/revise/status is included in the retrospective browser artifact. Do not add candidate attempt controls.

- [ ] **Step 8: Add representative mobile checks**

Check Worker evidence page, Company workforce/order page, Verifier queue/detail and Admin assessment pages at 390×844 for horizontal overflow and inaccessible primary controls.

- [ ] **Step 9: Run the real Chromium workflow**

Expected: all checkpoints PASS, no pageerror/console error from product code, screenshots/results/server log uploaded. Any failure enters Systematic Debugging before further feature work.

---

### Task 3: Add purpose-relevant concurrency and performance audit

**Files:**
- Create: `tests/platform/phase1-retrospective-performance.test.mjs`
- Create: `scripts/run-phase1-retrospective-performance.mjs`
- Create or modify: `.github/workflows/phase1-retrospective-audit.yml`
- Modify: `.engineering/PRE-M2.06-AUDIT-EVIDENCE.md`

**Interfaces:**
- Consumes: existing role/session, tenant, review, Question Bank and M2.05 services/test fixtures.
- Produces: deterministic correctness-under-load results with recorded elapsed times and no unsupported production-throughput claim.

- [ ] **Step 1: Write concurrency assertions before the runner**

Tests must prove:
- parallel live-session role checks cannot cross role boundaries;
- two-company operations never leak tenant data;
- multi-writer review claim/decision converges to legal state;
- eight-way Question Bank stale revision yields one winner;
- same-case M2.05 generation converges to one form;
- same Worker/different-case generation cannot repeat a stable question;
- a 50-request mixed-role authenticated read burst returns only authorized status/data.

- [ ] **Step 2: Record elapsed timings without brittle vanity thresholds**

For each group write structured JSON evidence containing operation count, successes, expected conflicts/denials, elapsed milliseconds and integrity assertions. Fail on correctness, timeout/deadlock, unbounded error, or cross-scope leakage. Use a generous whole-suite timeout rather than claiming a p95 SLA from GitHub-hosted hardware.

- [ ] **Step 3: Add a permanent audit workflow**

`phase1-retrospective-audit.yml` must run the performance/concurrency runner, strict TypeScript and lint and upload `artifacts/phase1-retrospective/**`.

- [ ] **Step 4: Execute exact-head audit**

Classify every red result using Systematic Debugging. No product fix occurs until the smallest failing reproduction and root cause are documented.

---

### Task 4: Repair every reproduced foundation defect with TDD

**Files:**
- Modify only the affected M1.01–M2.05 source/schema/UI file proven by each defect.
- Add the smallest permanent regression under `tests/**` and/or `scripts/hard-browser-qa.mjs`.
- Create: `.engineering/PRE-M2.06-AUDIT-REJECTION-<N>.md` for every blocking defect.
- Modify: `.engineering/CONTINUATION.json` after each root-cause cycle.

**Interfaces:**
- Consumes: a deterministic audit failure and its exact reproduction.
- Produces: one root-cause correction with permanent regression proof and no scope expansion.

- [ ] **Step 1: Use Systematic Debugging Phase 1–3**

Read full error, reproduce, inspect recent code, trace data across UI→server action/service→database, compare with a working pattern, and write a single root-cause hypothesis.

- [ ] **Step 2: Use Test-Driven Development**

Write/retain the failing regression first. Confirm it fails for the expected reason.

- [ ] **Step 3: Implement one root-cause fix**

No unrelated refactor. Preserve history, authorization and frozen product semantics.

- [ ] **Step 4: Re-run affected targeted + browser/performance regression**

Do not accept a fix from a unit suite alone when the original defect was a UI/workflow failure.

- [ ] **Step 5: Update audit ledger and Governor checkpoint**

Record classification, reproduction head/run, root cause, correction head/run and residual risk.

---

### Task 5: Gatekeeper retrospective acceptance

**Files:**
- Create: `.engineering/PRE-M2.06-AUDIT-ACCEPTANCE.md`
- Modify: `.engineering/PRE-M2.06-AUDIT-EVIDENCE.md`
- Modify: `.engineering/CONTINUATION.json`

**Interfaces:**
- Consumes: complete audit matrix, exact-head browser/performance/targeted/full Engineering results, review findings.
- Produces: `ACCEPT` or `REJECT` for resuming M2.06 production work.

- [ ] **Step 1: Use Requesting Code Review**

Review architecture, authorization/tenant isolation, history/data integrity, browser UX/dead controls, performance/concurrency and stale temporary test/repair code.

- [ ] **Step 2: Run Verification Before Completion**

Require fresh exact-head: retrospective browser, retrospective performance, all affected targeted gates, strict TypeScript, lint, full Engineering verification and retained artifacts.

- [ ] **Step 3: Issue Gatekeeper verdict**

`ACCEPT` only if all M1.01–M2.05 rows are `PROVEN` or justified `N/A/EXTERNAL_PROVIDER_BOUNDARY` and no blocker remains. Otherwise remain `CONTINUE` in defect repair.

- [ ] **Step 4: Persist Continuation state**

On ACCEPT, set retrospective state `ACCEPTED` and resume the pre-existing M2.06 Task 3 RED at its exact missing-service boundary.

---

### Task 6: Resume and finish M2.06 after retrospective acceptance

**Files:**
- Existing contract: `.engineering/M2.06-WORK-CONTRACT.md`
- Existing design: `docs/superpowers/specs/2026-08-18-m2-06-assessment-catalogue-eligibility-design.md`
- Existing plan: `docs/superpowers/plans/2026-08-18-m2-06-assessment-catalogue-eligibility.md`
- Existing RED: `tests/platform/assessment-catalogue-eligibility-runtime.test.mjs`
- Create after audit acceptance: `src/lib/assessment-catalogue/assessment-catalogue-eligibility-service.ts`
- Add Admin/Worker routes and M2.06 Chromium/audit gates per frozen M2.06 plan.

- [ ] **Step 1: Reconfirm Task 3 RED**

Expected failure: missing `assessment-catalogue-eligibility-service.ts`, while M2.06 contract/audit/Admin service remain green.

- [ ] **Step 2: Implement read-only eligibility service**

Use authenticated `principal.accountId`, owned `Assessment pending` case, immutable policy snapshot framework, ACTIVE catalogue/stable blueprint, exact pinned blueprint version, and `COUNT(DISTINCT record_id)` only for exact-current `submitted` qualification versions with task+decision `APPROVED` on the same version.

- [ ] **Step 3: Prove no side effects and safe DTO**

No generated forms/attempt rows, no case mutation, no reviewer/evidence/scoring secrets.

- [ ] **Step 4: Complete Admin/Worker UI and Chromium**

Worker page contains no dead Start button because attempt authority begins at M2.07.

- [ ] **Step 5: Exact-head review/gates/merge/mainline verification**

Follow the same Work Contract → TDD → browser → performance/regression → Engineering → Gatekeeper → merge → mainline verification sequence used for M2.05.

---

### Task 7: Build the remaining four canonical milestones sequentially

**Files:**
- Create one frozen design/Work Contract/implementation plan/branch per milestone before production code.
- M2.07: Candidate Assessment Window.
- M2.08: Answer Persistence and Interruption Recovery.
- M2.09: Integrity Engine.
- M2.10: Written Scoring and Review Engine.

- [ ] **Step 1: M2.07 contract and implementation**

Own pre-assessment checks, dedicated assessment window, one-question-at-a-time safe delivery, answer-minimum gating before Next, progression modes, technical issue reporting and Emergency Exit. The complete form remains server-side and future question material never reaches the browser.

- [ ] **Step 2: M2.08 contract and implementation**

Own answer autosave/version persistence, idempotent submission, offline/reconnect state, device binding and controlled interruption recovery/replacement form while excluding every already displayed stable question.

- [ ] **Step 3: M2.09 contract and implementation**

Own camera/mic/screen/browser integrity events, classifications, degraded mode and immutable evidence timeline without silently trapping the candidate or blocking the required Emergency Exit.

- [ ] **Step 4: M2.10 contract and implementation**

Own written-answer reviewer queue, exact question/answer versions, rubric criterion marking, AI-assistance boundary, reviewer conflicts/calibration and immutable finalized/amended scoring history. AI may assist but must not independently issue a high-stakes final decision unless a published rule explicitly allows it.

- [ ] **Step 5: Gate each milestone independently**

Each milestone requires RED/GREEN TDD, real Chromium of its owned UI/workflow, purpose-relevant concurrency/performance, security/data-integrity review, regression review, full Engineering verification, Gatekeeper acceptance, merge, and merged-main verification before advancing to the next brick.
