# M1.04 Subunit 4 — Company-Scope Bootstrap and Protected Demonstration

## Purpose

This subunit makes the accepted M1.04 tenant-isolation enforcement visible and testable through one neutral Company-only surface without building later Company business workflows early.

The page is a security demonstration, not Company settings or operational data. It uses the temporary neutral `authorization_tenant_scope_fixtures` table introduced in subunit 3.

## Protected route

```text
/company/tenant-scope
```

Access requires:

1. an active opaque session;
2. active Company role assignment;
3. active Company tenant and current membership;
4. `company.tenant.read` for page/list access;
5. `company.settings.manage` for create/update/delete demonstration commands.

Missing cookies receive a pre-render redirect to Company login. Present but invalid, stale, wrong-role or under-permissioned sessions remain subject to the database-backed central authorization service.

## Browser input boundary

The browser may send only:

- neutral fixture ID for update/delete;
- optimistic expected version;
- neutral record key;
- synthetic title;
- synthetic note;
- create/update intent.

The browser cannot send or select:

- tenant ID;
- membership ID;
- account or session identity;
- role;
- permission;
- ownership;
- scope.

Every operation resolves the current tenant from the authenticated session and active membership again on the server.

## Read and command path

```text
Company page/server action
  -> central current-tenant permission guard
  -> permission-bound trusted principal
  -> tenant-scoped repository
  -> transactionally revalidated session/account/role/tenant/membership/permission
  -> SQL containing the trusted tenant predicate
```

Cross-tenant and missing fixture identifiers produce the same non-enumerating result.

## Visible states

The surface provides:

- masked tenant reference and membership role;
- explicit synthetic-data warning;
- empty state;
- route loading state;
- safe route failure and retry state;
- server-side field validation;
- pending labels and duplicate-submit disabling;
- successful create/update without manual refresh;
- optimistic version-conflict message and reload;
- delete confirmation;
- deleted or unchanged non-enumerating result;
- navigation back to the Company dashboard.

## Deterministic test bootstrap

`tests/support/company-scope-bootstrap.mjs` creates disposable synthetic Company accounts, tenants, memberships and sessions inside in-memory PGlite databases. It is test-only and does not add public Company registration or production bootstrap behavior.

## Automated coverage

- `scripts/check-company-scope-demonstration.mjs`
- `tests/platform/authorization-company-scope-demonstration.test.mjs`
- `tests/engineering/handoff-domain.test.mjs`
- signed-out real-development redirect smoke;
- standalone preview redirect smoke;
- existing subunit 3 repository and concurrency suites;
- complete `npm run verify:full`.

Coverage proves:

- no client tenant/scope selector;
- protected route and action integration;
- two synthetic tenants list only their own records;
- same record key can exist independently per tenant;
- cross-tenant find/update/delete equals missing-record behavior;
- stale membership cannot use the command boundary;
- loading, empty, failure, validation, pending, confirmation and no-refresh contracts exist;
- generated owner handoff names only the affected Company and copied-role visible workflows.

## Explicit exclusions

This subunit does not build:

- Company public registration or verification;
- real Company settings;
- sites, departments or team permissions;
- Worker directory, invitations or Company codes;
- evidence, uploads or verification cases;
- notifications or the immutable audit engine;
- assessments, interviews, billing or reporting.

Those remain in their canonical bricks.

## Acceptance

Subunit 4 requires:

1. focused source/domain/database/runtime tests;
2. complete affected and full engineering gates;
3. production build and preview smoke;
4. generated handoff and evidence artifact;
5. merged-main CI pass;
6. owner completion of only the generated visible browser steps;
7. clean shutdown and synchronized Git state.

Subunit 5 remains blocked until this subunit is owner-accepted.
