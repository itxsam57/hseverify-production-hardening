# M1.04 Tenant-Scoped Repository/Command Guards — Final Owner Acceptance

Status: **DONE — OWNER PASS — 5 AUGUST 2026**

This record accepts only M1.04 internal subunit 3. It does not complete the M1.04 brick.

## Accepted implementation chain

- Pull request: `#27`
- Validated PR head: `c26a6d1ef0564c6511f9575c39643779b539f5c2`
- Merge commit: `f44d248f7da9bd815fdfbc869a3a7a374ad708e2`
- Final PR run: `31023856354`
- Final PR job: `92367329693`
- Merged-main run: `31024142785`
- Merged-main job: `92368137924`
- Automated result: **PASS**

## Owner environment

- Operating system: Windows 10
- Repository: `C:\Users\arsla\hseverify`
- Browser: Google Chrome
- Terminal: normal Command Prompt
- Administrator terminal: not required
- Windows Developer Mode: not required

## Owner acceptance results

### Worker portal isolation — PASS

The owner confirmed:

- Worker login succeeded;
- the Worker dashboard opened;
- a copied Company dashboard URL did not display Company content;
- the access-denied boundary appeared;
- returning to the Worker dashboard preserved the valid Worker session;
- Worker logout completed normally.

### Company portal and tenant-session isolation — PASS

The owner confirmed:

- Company password login succeeded;
- the required TOTP step succeeded;
- the Company dashboard opened;
- a copied Worker dashboard URL did not display Worker content;
- the access-denied boundary appeared;
- returning to the Company dashboard preserved the valid Company session;
- Company logout completed normally.

### Clean shutdown — PASS

The development server stopped normally with `Ctrl+C`; no forced termination was required.

### Clean synchronized Git state — PASS

The owner ran:

```cmd
git pull --ff-only origin main && git status --short && git diff --check && git status -sb
```

Confirmed:

- pull succeeded;
- `git status --short` printed nothing;
- `git diff --check` printed nothing;
- final state was `## main...origin/main`;
- no ahead, behind, modified or untracked entry remained.

## Automated boundary accepted

The owner does not need to repeat the database suites. The accepted automated evidence proves:

1. accepted tenant permission is bound to the trusted Company principal;
2. tenant scope is derived only from authenticated session, account and membership context;
3. every neutral fixture read, write, existence, uniqueness, version and delete statement includes tenant scope directly in SQL;
4. no route, form, header, cookie, query string or body can select tenant, membership, role, permission, ownership or scope;
5. fetch-global-then-filter and record-ID-only tenant queries are prohibited;
6. cross-tenant and missing records are non-enumerating;
7. session, account, role, tenant, membership and permission state are revalidated inside the same transaction as the data operation;
8. tenant-scoped uniqueness, optimistic versioning, stale membership, stale session and permission races have migrated database coverage;
9. migration `0006_authorization_tenant_scope_fixture` rolls back independently and reapplies cleanly;
10. all previously accepted authentication, authorization, migration, runtime, build and engineering-gate regressions remain green.

## Explicit exclusions

This acceptance does not implement or accept:

- Company registration or verification;
- real Company settings;
- sites, departments, Company team or Worker directory;
- invitations, codes, evidence, notifications, assessments or billing;
- final M1.04 cross-role/cross-tenant endpoint and concurrency acceptance.

## Next permitted build unit

M1.04 internal subunit 4:

```text
Company-scope bootstrap fixtures and protected demonstration surfaces
```

Subunit 4 may now begin. M1.05 and later bricks remain blocked until the entire M1.04 brick is DONE.
