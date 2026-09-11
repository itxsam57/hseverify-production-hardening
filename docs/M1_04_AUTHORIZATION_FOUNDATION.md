# M1.04 Authorization and Tenant Isolation — Foundation Status

## Status

**IMPLEMENTED ON FEATURE BRANCH — AUTOMATED VALIDATION AND OWNER TEST PENDING**

Branch:

```text
feature/m1-04-authorization-foundation
```

This document covers only M1.04 internal subunit 1: authorization domain and tenant schema foundation. It does not claim the complete M1.04 brick.

## Implemented boundary

### Explicit permission domain

`src/lib/authorization/authorization-domain.ts` defines:

- stable platform permissions;
- stable Company-tenant permissions;
- least-privilege grants for Worker, Company, Assessor, Verifier, Administrator and Root;
- Company tenant roles: owner, admin, manager and viewer;
- explicit tenant and membership lifecycle states;
- opaque tenant and membership ID generators;
- platform permission evaluation;
- tenant permission evaluation;
- membership-role permission ceilings;
- permission override validation;
- active Company-portal requirement for tenant permission evaluation;
- denial for pending, suspended and archived tenants;
- denial for invited, suspended and revoked memberships;
- membership self-grant/self-modification rejection;
- grant-above-authority rejection;
- safe denial classifications.

Permissions are explicit strings. Wildcards are prohibited.

Root does not receive routine Company tenant management through an implicit or blanket grant. Root emergency/security capabilities remain separate from Administrator operational permissions.

### Tenant schema foundation

Migration `0005_authorization_tenant_isolation` creates:

- `platform_tenants`;
- `auth_tenant_role_permission_ceiling`;
- `auth_tenant_memberships`;
- `auth_tenant_permission_overrides`.

The schema enforces:

- opaque, context-prefixed tenant and membership identifier shapes;
- Company tenant type;
- tenant lifecycle state consistency;
- Company-role assignment before tenant membership;
- explicit tenant membership role and status;
- one current membership record per tenant/account pair;
- explicit permission keys with no wildcard;
- a persisted role-permission ceiling;
- membership-role identity on every override;
- SQL-level rejection of permissions above the membership role ceiling;
- one override per membership/permission;
- retained actor and reason metadata for permission overrides.

This schema is security foundation only. It does not implement M1.08 Company registration, Company verification, sites, departments or team-management screens.

### Reversibility

`0005_authorization_tenant_isolation.down.sql` removes only the M1.04 foundation tables, including the role-permission ceiling. Accepted M1.01–M1.03 tables remain intact.

## Permanent automated coverage

### Domain tests

`tests/authorization/authorization-domain.test.mjs` covers:

- permission registry uniqueness;
- wildcard rejection;
- opaque non-sequential IDs;
- explicit tenant lifecycle vocabulary;
- least-privilege platform grants;
- tenant role permission ceilings;
- Root separation from routine tenant management;
- permission override limits;
- non-Company portal rejection;
- tenant mismatch rejection;
- inactive tenant and membership denial;
- self-grant rejection;
- grant-above-authority rejection.

### Migrated database tests

`tests/platform/authorization-tenant-foundation.test.mjs` covers:

- complete five-layer migration status;
- all four M1.04 foundation tables;
- seeded role-permission ceiling integrity;
- opaque identifier constraints;
- Company-role membership enforcement;
- duplicate current membership rejection;
- tenant and membership lifecycle constraints;
- wildcard and unknown permission rejection;
- membership-role mismatch rejection;
- SQL-level grant-above-ceiling rejection;
- duplicate override rejection;
- rollback of only `0005`;
- clean reapplication of `0005`;
- source-contract markers.

Existing platform, authentication and Worker-registration migration tests are extended so they preserve all accepted lower layers while recognizing `0005` as the latest layer.

## Security boundary not yet claimed

The following remain later M1.04 subunits:

1. authorization context loaded from the live authenticated database session;
2. central server permission guards;
3. tenant-scoped repository/query/command enforcement;
4. protected Company demonstration surfaces;
5. complete cross-tenant direct-endpoint and concurrency suite;
6. final M1.04 owner acceptance.

No application route may claim complete tenant isolation from this foundation alone.

## Acceptance gate

Before subunit 2 begins:

1. focused authorization source/domain/database tests pass;
2. complete `npm run check` passes;
3. migration `0005` rolls back and reapplies independently;
4. Windows owner hard test passes;
5. repository state is clean;
6. no release-blocking owner defect remains.
