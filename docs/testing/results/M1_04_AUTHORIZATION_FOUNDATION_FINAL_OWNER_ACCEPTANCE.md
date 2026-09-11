# M1.04 Authorization Foundation — Final Owner Acceptance

Status: **OWNER PASS**

Accepted: 4 August 2026

Repository: `itxsam57/hseverify`

Implementation merge:

```text
f1479f72cf189b158144cb7f6afc77623bf40489
```

Pull request: **#23**

## Accepted scope

This record accepts only M1.04 internal subunit 1: **authorization domain and tenant schema foundation**.

The accepted boundary includes:

1. explicit platform and Company-tenant permission vocabularies;
2. exhaustive least-privilege matrices for Worker, Company, Assessor, Verifier, Administrator and Root;
3. tenant roles owner, admin, manager and viewer;
4. opaque tenant and membership identifiers;
5. tenant and membership lifecycle denial rules;
6. one unambiguous current Company tenant membership per Company account;
7. SQL-enforced tenant-role permission ceilings;
8. wildcard, duplicate, role-mismatched and grant-above-ceiling override rejection;
9. role mismatch, missing tenant context, cross-tenant context, inactive tenant and inactive membership denial;
10. membership self-grant/self-modification rejection;
11. Root separation from routine Company tenant management;
12. independently reversible migration `0005_authorization_tenant_isolation`;
13. permanent domain, source-contract, migrated-database, policy-alignment and rollback tests inside `npm run check`.

## Owner hard-test result

| Gate | Result |
|---|---|
| A. Pull/install and clean baseline | PASS |
| B. Migration `0005` apply/status | PASS |
| C. Authorization source/domain gate | PASS |
| D. Authorization migrated-database gate | PASS |
| E. Complete `npm run check` | PASS |
| F. Manual `0005` rollback/reapply | PASS |
| G. Existing M1.03 authentication regression | PASS |
| H. Clean shutdown and Git state | PASS |
| No Administrator or Developer Mode requirement | PASS |

## Authentication regression confirmed

- Worker login page opened correctly;
- existing Worker credentials still signed in;
- Company password plus TOTP still opened the Company dashboard;
- a Worker session could not enter the Company portal;
- a signed-out Company dashboard request redirected to Company login.

## Final repository state

Owner-confirmed final branch status:

```text
## main...origin/main
```

Also confirmed:

- `git status --short` produced no output;
- `git diff --check` produced no output;
- protected configuration diff for `tsconfig.json`, `package.json`, `package-lock.json` and `next.config.ts` produced no output;
- no tracked, modified, untracked, ahead or behind state remained.

## Defects

None reported.

## Verdict

M1.04 internal subunit 1 is **DONE — OWNER PASS**.

M1.04 as a whole remains **IN PROGRESS**. This acceptance does not claim live session-derived authorization context, tenant-scoped repository/query/command guards, protected Company demonstration surfaces or the complete cross-role/cross-tenant endpoint and concurrency suite.

M1.05 and later bricks remain blocked until all M1.04 subunits are implemented and owner-accepted.
