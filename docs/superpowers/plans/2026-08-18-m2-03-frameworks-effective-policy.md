# M2.03 Frameworks and Effective Policy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans and superpowers:test-driven-development. Do not promote the milestone without the exact-head targeted gate and full Engineering gate.

**Goal:** Add versioned assurance frameworks and policy packs, controlled Company overrides, deterministic effective-policy resolution, and immutable case policy snapshots that replace M2.01's temporary framework/policy validation blockers.

**Architecture:** Global assurance configuration is platform-owned and versioned. Company overrides are tenant-scoped and may change only fields explicitly allowed by the active global policy version. The resolver derives the effective result on the server, rejects gaps/overlaps/disallowed overrides, and pins one immutable snapshot to each Assurance Case. Submitted cases never follow later policy edits.

**Tech Stack:** Next.js App Router, TypeScript strict mode, PostgreSQL/PGlite migrations, existing platform/tenant authorization guards, Node test runner, GitHub Actions.

**Base:** M2.02 merged `main` at `9d4a2f09ac91fd3f95bc44155d9817da2fa28262`.

## Global constraints

- No browser-supplied tenant, case, policy-version, source, or resolved-value authority.
- Global framework/policy management requires fixed `admin` role plus existing platform operations authority.
- Company overrides require live tenant-scoped `company.settings.manage` authority.
- Overrides can only touch `override_allowed_fields`; non-overrideable global controls are floors and may not be weakened.
- Effective selection for a case is deterministic at the order/submission reference time. Zero or multiple matching active versions fails closed.
- A case policy snapshot stores global version lineage, optional tenant override lineage, resolved JSON, source, and resolution time. Snapshot rows are immutable/history-bearing.
- Cross-tenant copied IDs are non-enumerating.
- M2.01 order validation must stop emitting the temporary “dependency is not yet available” errors when real framework/effective-policy references are valid.
- No M2.04 question-bank or later assessment-attempt authority is introduced here.

## TDD tasks

1. **RED — persistence contract**
   - Add contract tests requiring framework, policy pack, policy version, tenant override and case snapshot schema.
   - Require uniqueness/versioning, active-window validity, history-preserving down migration, and append-only snapshots.

2. **GREEN — migration/domain**
   - Add `0035_frameworks_effective_policy` migration.
   - Add normalized identifiers, JSON policy values, allowed-field metadata, status/effective windows, and immutable snapshots.
   - Add typed M2.03 domain errors/records.

3. **RED — resolver runtime semantics**
   - Real PGlite tests for global-only resolution, allowed override, disallowed field, weaker override, gap, overlap, cross-tenant copied override, concurrent snapshot race, and future policy edit not mutating a pinned case.

4. **GREEN — repository/service**
   - Implement platform framework/policy creation/version publication.
   - Implement Company override save/deactivate with live tenant permission.
   - Implement deterministic effective-policy resolver and case snapshot pinning.
   - Audit mutations through the existing audit repository.

5. **RED/GREEN — M2.01 integration**
   - Replace temporary framework/effective-policy blockers in `AssuranceOrderService.validateOrder` with server-side M2.03 validation.
   - Ensure invalid/missing/ambiguous references fail closed with explicit validation errors.
   - Keep interview/credential blockers owned by later milestones.

6. **RED/GREEN — minimal authorized UI**
   - Admin framework/policy inspection and version publishing surface.
   - Company effective-policy/override settings surface.
   - Forms carry only user-entered policy content/override fields and opaque references; server derives scope/version authority.

7. **Hard verification**
   - Contract checks plus production-module PGlite runtime suite.
   - Concurrency, copied-ID/tenant denial, immutability, version-window ambiguity and rollback/reapply semantics.
   - Strict TypeScript, lint, build/full Engineering verification.
   - Draft PR from this branch to `main`; merge only exact verified head; verify merged tree/main before M2.04.
