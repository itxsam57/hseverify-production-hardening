# M1.04 Subunit 3 — Tenant-Scoped Repository/Command Guards

Status: **MERGED — AUTOMATED PASS — OWNER TEST PENDING**

Date: 5 August 2026

## Implementation

- Pull request: `#27`
- Exact validated PR head: `c26a6d1ef0564c6511f9575c39643779b539f5c2`
- Merge commit: `f44d248f7da9bd815fdfbc869a3a7a374ad708e2`
- Implementation document: `docs/M1_04_TENANT_SCOPED_REPOSITORY_GUARDS.md`
- Owner guide: `docs/testing/M1_04_TENANT_SCOPED_REPOSITORY_GUARDS_HARD_TEST.md`

## Accepted automated boundary

The merged implementation provides:

1. exact accepted tenant-permission binding on the trusted Company principal;
2. tenant scope derived only from authenticated session/account/membership context;
3. direct tenant predicates in every fixture list, find, insert, update, delete, uniqueness and locking statement;
4. no client tenant, membership, role, permission, ownership or scope selector;
5. no fetch-global-then-filter or record-ID-only tenant lookup;
6. non-enumerating cross-tenant and missing-record behavior;
7. transactionally revalidated session, account, assigned Company role, tenant, membership, permission ceiling and deny overrides for reads and writes;
8. authorization revalidation and the data operation inside the same transaction;
9. tenant-scoped uniqueness and optimistic version control;
10. a neutral, removable tenant-owned authorization fixture rather than an early business domain;
11. reversible migration `0006_authorization_tenant_scope_fixture`;
12. permanent source, pure-domain, migrated database, rollback, stale-authority and concurrency tests inside the complete gate.

## Explicit exclusions

This subunit does not implement Company registration, verification, sites, departments, workforce, invitations, evidence, notifications, assessments, billing or any other later business workflow. Future real tenant-owned repositories must adopt the accepted enforcement base and add their own domain tests.

## Automated evidence

### Final pull-request candidate

- Run: `31023856354`
- Job: `92367329693`
- Artifact: `8937818093`
- Result: **PASS**

### Merged main

- Run: `31024142785`
- Job: `92368137924`
- Result: **PASS**

Both passed:

- locked dependency installation;
- complete `npm run verify:full`;
- tenant-scope source contracts;
- pure tenant-scope domain tests;
- migrated same-tenant and cross-tenant repository tests;
- non-enumerating result tests;
- tenant-scoped uniqueness and concurrency tests;
- stale membership, session and permission revalidation tests;
- migration `0006` rollback/reapply;
- all earlier migration and authentication/authorization regressions;
- strict TypeScript and ESLint;
- development, redirect and database-backed runtime smoke;
- deterministic production build;
- deployable preview smoke;
- release manifest, handoff generation and evidence upload.

## Audit findings repaired

The complete gate initially exposed historical tests that treated migration `0005` as the final migration. The implementation itself and focused tenant-scope tests were already passing. The following test chains were updated without weakening their prior guarantees:

- general migration/idempotency/latest-rollback;
- authentication rollback chain;
- authorization rollback chain;
- Worker registration rollback chain.

Each now proves `0006` rolls back independently, underlying layers remain intact, and the migration chain reapplies in order.

## Owner acceptance gate

The owner must complete only:

1. Worker login and copied Company dashboard denial while the Worker session remains valid;
2. Company TOTP login and copied Worker dashboard denial while the Company session remains valid;
3. clean server shutdown;
4. clean and synchronized local `main` state.

Subunit 3 is not owner-accepted yet. Subunit 4 remains blocked until all owner checks pass and no release-blocking defect remains.
