# M2.06 Assessment Catalogue and Eligibility Implementation Plan

**Goal:** Build a versioned Admin Assessment Catalogue and a backend-authoritative Worker availability read model using owned `Assessment pending` cases, locked M2.03 framework, exact M2.05 blueprint versions and approved exact-current submitted qualification evidence.

**Spec:** `docs/superpowers/specs/2026-08-18-m2-06-assessment-catalogue-eligibility-design.md`

## Constraints
- M2.06 is read-only for Worker eligibility and must never create M2.05 forms or M2.07 attempts.
- Worker identity comes only from the authenticated principal.
- Add `worker.assessments.read` only to Worker role.
- Catalogue pins exact immutable M2.05 blueprint version; blueprint need not remain current, but its stable blueprint must remain ACTIVE.
- Current submitted qualification versions count only when M2.02 task and decision both APPROVED for that same exact version.
- Catalogue/version history is append-only and rollback is history-preserving.
- No dead Start-assessment control.

### Task 1 — Schema, permission and domain
**Files:**
- `database/migrations/0040_assessment_catalogue_eligibility.up.sql`
- `database/migrations/0040_assessment_catalogue_eligibility.down.sql`
- `src/lib/assessment-catalogue/assessment-catalogue-domain.ts`
- `src/lib/authorization/authorization-domain.ts`
- `tests/platform/assessment-catalogue-contract.test.mjs`

1. RED: contract test requires stable/version tables, self/version and framework/blueprint composite FKs, append-only versions, history-preserving down, three audit actions, `worker.assessments.read` permission and Worker-only role grant, domain normalizers and minimum `0..50`.
2. GREEN: implement only schema/domain/permission.
3. Run contract + audit sync + strict TS.

### Task 2 — Admin catalogue service
**Files:**
- `src/lib/assessment-catalogue/assessment-catalogue-service.ts`
- `tests/platform/assessment-catalogue-runtime.test.mjs`
- runtime compiler script

RED runtime proves create v1, active exact blueprint/framework validation, revoked Admin denial, duplicate reference conflict, 8-way stale revision one winner, status history, append-only tamper, dedicated audits and cross-framework rejection.

GREEN service follows M2.05 live-Admin patterns. It creates stable INACTIVE row, immutable version, then ACTIVE current pointer in one transaction.

### Task 3 — Worker eligibility read service
**Files:**
- `src/lib/assessment-catalogue/assessment-catalogue-eligibility-service.ts`
- `tests/platform/assessment-catalogue-eligibility-runtime.test.mjs`
- runtime compiler script

RED runtime proves:
- Worker-only live session + permission;
- copied other-Worker case id returns null/empty;
- only `Assessment pending` + immutable policy snapshot + same framework + ACTIVE catalogue/blueprint;
- zero-prerequisite availability;
- min1 fails without evidence;
- exact-current submitted APPROVED qualification makes min1 available;
- approved old version stops qualifying after current version changes;
- rejected/changes-requested/other-Worker evidence never qualifies;
- DTO hides review/evidence secrets;
- eligibility read creates no form and changes no case status.

GREEN implementation uses one authoritative SQL eligibility query and no browser Worker id.

### Task 4 — Admin + Worker visible UI
**Files:**
- `src/app/admin/(portal)/assessment-catalogue/actions.ts`
- `src/app/admin/(portal)/assessment-catalogue/page.tsx`
- `src/app/worker/(portal)/available-assessments/page.tsx`
- `src/components/auth/role-portal-shell.tsx`
- `scripts/m2-06-browser-qa.mjs`
- `.github/workflows/m2-06-browser.yml`

RED real Chromium provisions Root/Admin and a Worker, verifies missing routes/links.
GREEN proves Admin catalogue create/revise/status through visible controls and Worker route/navigation without a dead attempt-start control.

### Task 5 — Permanent gates and final review
**Files:**
- `scripts/run-assessment-catalogue-tests.mjs`
- `.github/workflows/m2-06-targeted.yml`
- `scripts/run-engineering-gate.mjs`

Aggregate contract, runtime and eligibility tests; run strict TS/lint; add M2.06 to Engineering gate; require exact-head M2.06 targeted + M2.06 Chromium + inherited Hard Browser + Engineering success; review no M2.07 attempt/scoring authority leaked.
