# M1.04 Authorization and Tenant Isolation — Session Context Status

## Status

**IMPLEMENTED ON FEATURE BRANCH — COMPLETE AUTOMATED GATE PASS — MERGE AND OWNER TEST PENDING**

Branch:

```text
build/m1-04-session-authorization-context
```

Pull request:

```text
#24
```

This document covers only M1.04 internal subunit 2: trusted session authorization-context integration and central permission checks. It does not claim tenant-owned repository/query/command enforcement or completion of the M1.04 brick.

## Accepted dependency

This subunit consumes, but does not replace, the owner-accepted subunit 1 boundary:

- explicit platform and Company-tenant permissions;
- fixed least-privilege role matrices;
- opaque Company tenant and membership identifiers;
- one current Company membership per account;
- tenant and membership lifecycle state;
- SQL permission ceilings and override constraints;
- migration `0005_authorization_tenant_isolation`.

The accepted permission vocabulary and grant matrices remain the single authorization source of truth.

## Implemented boundary

### Pure fail-closed session context domain

`src/lib/authorization/authorization-context-domain.ts` adds a pure authorization layer that resolves trusted database state into either an authorized principal or an explicit denial.

It resolves:

- opaque session identity;
- account identity and lifecycle status;
- fixed active portal role;
- proof that the active role remains assigned to the account;
- session creation, last-seen, expiry and revocation state;
- optional current Company tenant membership;
- tenant lifecycle state;
- membership lifecycle state and tenant role;
- validated permission overrides.

The central denial vocabulary includes:

- `unauthenticated`;
- `session_revoked`;
- `session_expired`;
- `session_stale`;
- `account_inactive`;
- `role_mismatch`;
- `permission_denied`;
- `tenant_context_missing`;
- `tenant_mismatch`;
- `tenant_inactive`;
- `membership_inactive`.

Session resolution fails closed for malformed timestamps, impossible timestamp ordering, excessive future clock skew, missing role assignment, inactive accounts, contradictory tenant context, invalid membership roles/statuses and invalid permission overrides.

### Canonical portal-entry permission registry

`PORTAL_ENTRY_PERMISSIONS` maps every fixed authentication role to exactly one accepted platform permission:

| Role | Required portal-entry permission |
|---|---|
| Worker | `worker.self.read` |
| Company | `company.portal.access` |
| Assessor | `interview.assigned.read` |
| Verifier | `verification.assigned.read` |
| Administrator | `platform.operations.read` |
| Root | `platform.security.read` |

Portal role and permission checks are therefore distinct but centrally composed. A correct role without its required permission is denied, and a different role cannot enter the portal even if it holds another platform permission.

### Authoritative session-to-context repository

`src/lib/authorization/authorization-context-repository.ts` provides the only database loader that turns an opaque session token hash into authorization context.

The exported `AUTHORIZATION_CONTEXT_SQL`:

- accepts only the server-derived session token hash as `$1`;
- joins the session to its account and exact assigned role;
- joins Company membership only when the authenticated active role is `company`;
- derives membership only from the authenticated account;
- loads the tenant lifecycle state;
- loads the membership role/status;
- loads validated permission overrides;
- does not accept tenant ID, membership ID, role, permission, scope, header, cookie field, form value or search parameter as a selector;
- deliberately returns revoked, expired and inactive account/session state so the central domain can classify denial instead of silently hiding it.

A Company session cannot choose another tenant. The schema's one-current-membership rule plus this query produce one unambiguous trusted tenant context.

### Central server-only authorization service

`src/lib/authorization/authorization-service.ts` is the single server authorization entry point.

It provides:

- `readServerAuthorizationContext()`;
- `requirePortalAuthorization()`;
- `requirePlatformPermission()`;
- `requireCurrentTenantPermission()`.

The service:

1. reads only the accepted HttpOnly session cookie;
2. hashes the opaque token using the accepted authentication pepper and context separation;
3. loads trusted state through `AuthorizationContextRepository`;
4. resolves lifecycle and context coherency through the pure domain;
5. evaluates permissions through the accepted subunit 1 matrices;
6. periodically touches a still-valid session without changing role or tenant context;
7. records authorization denials through the existing authentication security-event boundary;
8. redirects missing/expired/revoked/stale credentials to the expected fixed-role login;
9. redirects authenticated role/permission/tenant denials to the non-enumerating `/access-denied` boundary.

The service does not accept a tenant selector. Route code may request an existing typed permission but may not define a second role matrix or reinterpret grants.

### Existing portal integration

`src/lib/auth/auth-session-service.ts` preserves the accepted public API while delegating authorization to the new central service:

- `readAuthenticatedSession()` uses trusted context resolution;
- `requireRoleSession(expectedRole)` uses `requirePortalAuthorization(expectedRole)`;
- all existing Worker, Company, Assessor, Verifier, Administrator and Root protected layouts therefore pass through central permission enforcement;
- no role-switch or browser-selected role behavior is introduced;
- accepted session creation, logout, device/session listing and revocation behavior remains intact.

This integration avoids duplicating authorization logic in each layout.

## Permanent automated coverage

### Authorization context domain tests

`tests/authorization/authorization-context-domain.test.mjs` covers:

- unauthenticated denial;
- revoked, malformed, expired and stale session denial;
- inactive account denial;
- missing role assignment denial;
- impossible timestamp ordering and excessive future skew;
- canonical portal permission mapping for all six roles;
- role mismatch versus missing-permission classification;
- missing Company tenant context;
- invited and suspended membership denial;
- suspended tenant denial;
- allowed current-tenant permission evaluation;
- deny overrides;
- non-Company tenant-authority denial;
- invalid grant-above-ceiling override context failing closed.

### Exact migrated-database context tests

`tests/platform/authorization-session-context.test.mjs` extracts and executes the exact repository SQL against all migrations through `0005`.

It covers:

- Worker context derived only from the session token hash;
- no client or tenant selector parameter;
- current Company membership, tenant lifecycle and permission override derivation;
- preservation of revoked, expired and disabled state for central denial;
- one central server guard contract;
- delegation from the accepted M1.03 session service;
- prohibition of route-local role denial and client-selected tenant context.

### Existing authentication regression

`tests/platform/authentication-portal-isolation.test.mjs` now proves copied-URL and cross-role denial flow through the central authorization service while preserving every accepted fixed-role layout.

Existing authentication completion and invitation-expiry tests were made clock-relative after their formerly hard-coded 5 August 2026 expiry crossed real time. The production Root-bootstrap trigger and uniqueness index were not weakened.

### Permanent gate integration

The following remain inside `npm run check`:

- authorization source contracts;
- isolated strict authorization domain compilation;
- authorization context domain tests;
- migrated tenant foundation tests;
- SQL policy-ceiling tests;
- membership-context tests;
- exact session-context SQL tests;
- every accepted M1.01–M1.03 regression;
- strict project TypeScript;
- ESLint;
- development runtime smoke;
- database-backed application smoke;
- deterministic production build.

The isolated authorization compiler uses supported TypeScript `Node16` module semantics. Live Next.js TypeScript uses runtime-compatible extensionless source imports; emitted `.js` paths are prohibited by source contract.

## Automated gate result

GitHub Actions run `30977957284`, job `92215970805`, passed for PR #24 head:

```text
f0ab572eba34bb8437ede0c2e06fb5c5b576f5be
```

Passed stages:

1. locked dependency installation;
2. complete `npm run check`;
3. deployable preview smoke;
4. release evidence generation;
5. preview and release artifact upload.

The recorded moderate PostCSS advisory remains below the configured high-severity production-audit failure level. No forced dependency mutation was used.

## Defects found before acceptance

The branch gate found and repaired:

1. an M1.03 source-contract checker that still expected route-local denial markers;
2. an over-broad request-input regex that matched `platform_tenants`;
3. an unnormalized `role_permission_denied` variant;
4. clock-dependent Root invitation tests whose fixed expiry had passed in real time;
5. live Next.js imports that incorrectly referenced emitted `.js` paths;
6. a deprecated isolated TypeScript `Node`/Node10 resolution mode.

Every defect was repaired at its cause. No accepted permission, uniqueness, session, MFA, tenant or migration control was removed or relaxed.

## Security boundary not yet claimed

The following remain later M1.04 subunits:

1. tenant-scoped repositories, reads, writes and command guards;
2. prohibition tests for fetch-global-then-filter in actual tenant-owned modules;
3. Company bootstrap fixtures and protected demonstration surfaces;
4. complete cross-tenant direct-endpoint and concurrent-command suite;
5. final M1.04 migration/rollback and owner acceptance.

`requireCurrentTenantPermission()` is ready for tenant-owned operations, but no tenant-owned repository or business workflow is implemented in this subunit.

## Merge and owner gate

Before subunit 3 begins:

1. PR #24 must remain green through complete CI, preview smoke and release evidence;
2. implementation and owner-test documentation must be merged with the code;
3. merged `main` must pass the Windows owner hard test;
4. repository state must be clean and synchronized;
5. no release-blocking owner defect may remain.

M1.04 remains **IN PROGRESS** after subunit 2 acceptance. M1.05 and later bricks remain blocked.
