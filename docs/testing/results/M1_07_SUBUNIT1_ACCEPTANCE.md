# M1.07 Subunit 1 Acceptance

## Unit

**M1.07 — Worker Onboarding and Identity Engine**  
**Subunit 1 — Identity Domain, Versioned Persistence and State Machine**

## Result

**ENGINEERING PASS — 10 August 2026**

No browser/owner test is required for this subunit because it introduces no browser-visible product surface.

## Exact evidence

- Implementation PR: `#57`
- Accepted exact head: `f7ca497d5becdf7f0a828943c833a8e8915278b6`
- Exact-head engineering gate: `31374028751` — **PASS**
- Merge commit: `19a5ccc877834e78a6568a75099484aebdec0d1c`
- Merged-main engineering gate: `31374492294` — **PASS**

## Accepted behavior

- Worker identity is a separate relational aggregate and version history, not Worker Profile JSON.
- Identity lifecycle vocabulary and transitions are server-authoritative in TypeScript and SQL.
- A new identity starts as draft/version 1 and identity ownership/creation provenance is immutable.
- Submitted identity versions are immutable and correction lineage is database-protected.
- Worker commands are bound to the authenticated Worker principal and a live Worker session/account/role is revalidated inside the transaction.
- Worker self-service is narrower than the complete lifecycle: the Worker may submit and may withdraw before review, but cannot drive automated/reviewer decision states.
- Optimistic lock versions prevent concurrent material transitions from both succeeding.
- Identity creation and material state transitions append bounded immutable platform audit facts atomically with state.
- Identity migration/restart behavior is deterministic and monotonic; retained identity history is not deleted merely to move a migration ledger backward.
- No identity document fields, evidence-file binding, liveness/provider result, duplicate resolution, permanent Worker ID or visible `/worker/identity` UI is claimed by this subunit.

## Permanent regressions

### REG-073 — Authentication rollback independence

Immutable identity history originally used physical foreign keys to `auth_accounts`, making the accepted M1.03 authentication foundation no longer independently reversible beneath later layers. The root fix keeps durable historical account references without a physical dependency on rollback-owned authentication tables while validating live Worker authority at write time. The existing M1.03 rollback/reapply regression remains unchanged and passes.

### REG-074 — Runtime test dependency-injection boundary

The isolated identity runtime compiler originally recursed through the production database factory even though the platform tests inject a real migrated PGlite `DatabaseClient`. The root fix stubs only the database-construction module and requires the real client to be injected; it does not hard-code unrelated `.mjs` production dependencies and does not change production database code.

## Next gate

Subunit 1 is closed only after this closure branch itself passes the exact-head full engineering gate, merges with an expected-head lock, and the resulting `main` commit passes the complete engineering gate.

After that, **Subunit 2 — Worker Identity Draft and Verified Contact Binding** is the only permitted next internal unit. M1.08 and all later bricks remain blocked.
