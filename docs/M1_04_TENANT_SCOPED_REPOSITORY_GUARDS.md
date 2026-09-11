# M1.04 Subunit 3 — Tenant-Scoped Repository, Query and Command Guards

## Status

Implementation candidate for owner acceptance. M1.04 remains IN PROGRESS and subunit 4 remains blocked until this subunit passes the complete automated gate, merged-main verification and owner handoff.

## Purpose

This subunit converts the accepted server-derived Company tenant context into a structural repository and mutation boundary. A caller may identify the tenant-owned record it wants to operate on, but it cannot choose the tenant, membership, Company role, permission or ownership context.

## Trusted flow

1. A server service calls `requireCurrentTenantPermission()` with one canonical tenant permission.
2. The accepted `TenantAuthorizationPrincipal` is bound to that exact permission.
3. Repository reads derive tenant scope only from the bound principal.
4. Every read uses `tenant_id` directly in the SQL predicate.
5. Every mutation enters `runTenantScopedCommand()`.
6. The command transaction locks and revalidates the session, account, assigned Company role, tenant, membership, role permission ceiling and deny overrides.
7. The mutation uses the same transaction and the same principal-derived tenant scope.
8. Missing, stale, version-conflicting and cross-tenant records produce a non-enumerating result.

## Reusable contracts

### Permission-bound principal

`TenantPermissionPrincipal<P>` carries the one permission accepted by the central authorization service. Repository method signatures require the exact permission appropriate to the operation:

- read: `company.tenant.read`;
- neutral fixture write: `company.settings.manage`.

The runtime command guard rejects a principal whose bound permission differs from the command permission.

### Trusted scope

`deriveTrustedTenantScope()` returns only:

- tenant ID;
- membership ID;
- account ID;
- session ID.

All four values come from the accepted principal. There is no constructor taking a request-selected tenant.

### Transactional command guard

`TENANT_COMMAND_SCOPE_SQL` revalidates and locks:

- the exact membership ID and tenant ID from the principal;
- the exact account and session from the principal;
- active Company role assignment;
- active account;
- active tenant;
- active membership;
- unrevoked, unexpired Company session;
- permission inside the membership-role ceiling;
- absence of a deny override for the permission.

Authorization and mutation then share one database transaction.

## Neutral enforcement fixture

Migration `0006_authorization_tenant_scope_fixture` adds `authorization_tenant_scope_fixtures` only to prove the enforcement architecture before a real Company-owned domain is permitted.

The fixture:

- is not a site, department, worker, order, invoice, evidence record or business setting;
- uses opaque `tenantfixture_*` identifiers;
- uses `(tenant_id, fixture_id)` as its primary key;
- enforces uniqueness as `(tenant_id, record_key)`;
- binds its creating membership to the same tenant with a composite foreign key;
- stores only a small JSON object;
- has a reversible down migration;
- is clearly labelled as replaceable authorization-enforcement infrastructure.

## Repository SQL rules

The repository exports exact SQL constants so source and migrated-database tests can verify the real statements.

- List: `WHERE tenant_id = $1`.
- Find: `WHERE tenant_id = $1 AND fixture_id = $2`.
- Insert: tenant ID and membership ID come from trusted scope; uniqueness is tenant-scoped.
- Update: tenant ID, fixture ID and expected version appear in one predicate.
- Delete: tenant ID and fixture ID appear in one predicate.

Fetch-global-then-filter and record-ID-only lookup are prohibited.

## Non-enumerating behaviour

A cross-tenant record ID and a missing record ID both return no row. The repository never performs a global existence lookup to distinguish them. Update conflicts use one generic `TenantScopeConflictError` and command lifecycle/permission failures use one generic `TenantScopeDeniedError`.

## Concurrency and stale-context protection

The automated suite proves:

- concurrent inserts of the same tenant/key store one record;
- the same key is valid in a different tenant;
- a principal accepted before membership suspension is rejected when the command transaction revalidates;
- a principal accepted before session revocation is rejected when the command transaction revalidates;
- a permission deny override added after context resolution is enforced by the command transaction;
- optimistic version predicates prevent stale updates.

## Security boundaries preserved

- No role switching.
- No tenant switching.
- No browser-controlled tenant selector.
- No second permission registry.
- No wildcard permission.
- No Root or Administrator substitution for Company tenant authority.
- No weakening of M1.03 authentication or M1.04 subunits 1–2.
- Authorization denials continue through the existing security-event boundary at the central service; the full M1.05 audit engine is not built early.

## Files

Implementation:

- `database/migrations/0006_authorization_tenant_scope_fixture.up.sql`
- `database/migrations/0006_authorization_tenant_scope_fixture.down.sql`
- `src/lib/authorization/tenant-scoped-resource-domain.ts`
- `src/lib/authorization/tenant-scoped-command-guard.ts`
- `src/lib/authorization/tenant-scope-fixture-repository.ts`
- `src/lib/authorization/tenant-scope-fixture-service.ts`

Validation:

- `scripts/check-tenant-scope-guards.mjs`
- `tests/authorization/tenant-scoped-resource-domain.test.mjs`
- `tests/platform/authorization-tenant-scope-repository.test.mjs`
- `tests/platform/authorization-tenant-scope-concurrency.test.mjs`

## Acceptance gate

The subunit is not accepted until:

1. focused source/domain/database/concurrency tests pass;
2. `npm run verify:affected` passes;
3. `npm run verify:full` passes;
4. production build and deployable preview smoke pass;
5. migration rollback/reapply evidence passes;
6. the generated manual handoff is completed;
7. merged `main` passes the engineering gate;
8. no release-blocking defect remains;
9. the owner's repository is clean and synchronized when final acceptance is recorded.
