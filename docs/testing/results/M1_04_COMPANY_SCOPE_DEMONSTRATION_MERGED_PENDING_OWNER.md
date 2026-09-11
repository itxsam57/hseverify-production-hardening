# M1.04 Subunit 4 — Company-Scope Bootstrap and Protected Demonstration

Status: **MERGED — AUTOMATED PASS — OWNER TEST PENDING**

Date: 5 August 2026

## Implementation

- Pull request: `#28`
- Exact validated PR head: `d7999d50763775bc97d433451db869abbdfdc809`
- Merge commit: `752e6cec8b7e83981cece5113748c8c48e52d52d`
- Implementation document: `docs/M1_04_COMPANY_SCOPE_DEMONSTRATION.md`
- Owner guide: `docs/testing/M1_04_COMPANY_SCOPE_DEMONSTRATION_HARD_TEST.md`

## Merged boundary

The merged implementation provides:

1. deterministic test-only bootstrap for synthetic Company accounts, roles, tenants, memberships and sessions inside disposable PGlite databases;
2. a protected Company-only route at `/company/tenant-scope` linked from the Company dashboard;
3. central current-tenant read permission for page/list access;
4. central current-tenant write permission for create/update/delete;
5. accepted subunit 3 permission-bound principals and tenant-scoped repository/command enforcement;
6. browser forms containing only neutral fixture identity, expected version, key, title, note and intent;
7. no client-supplied tenant, membership, role, permission, ownership or scope selector;
8. non-enumerating missing and cross-tenant find/update/delete behavior;
9. two-tenant isolation with independent per-tenant uniqueness;
10. stale-membership command denial;
11. explicit empty, loading, validation, pending, conflict, safe failure, confirmation and success states;
12. create/update/delete visible without a manual browser refresh;
13. signed-out pre-render redirect coverage in real development and standalone preview;
14. one consolidated Company/Worker owner browser handoff;
15. no premature Company registration, verification, settings, sites, departments, team, workforce, invitations, evidence, notifications, assessments, interviews or billing.

## Automated evidence

### First audit attempt

- Run: `31031416540`
- Job: `92392784673`
- Result: **FAIL**

The first run stopped in a newly added handoff unit test because it asserted one exact wording variant for the same tenant boundary. Product source/security checks before that point passed. The assertion was corrected to test semantic content; no application logic or security rule was weakened.

### Complete corrected candidate

- Intermediate complete run: `31031529082`
- Job: `92393158203`
- Result: **PASS**

### Final exact pull-request candidate

- Run: `31031974398`
- Job: `92394756813`
- Artifact: `8941090250`
- Result: **PASS**

This final candidate additionally consolidated overlapping generic auth/authorization handoff items into one exact Company/Worker owner workflow while retaining all broader automated security tests.

### Merged main

- Run: `31032355746`
- Job: `92395916146`
- Result: **PASS**

The final PR and merged-main runs passed:

- locked dependency installation;
- complete `npm run verify:full`;
- engineering/source contracts;
- central authentication and authorization regressions;
- tenant-scoped repository and concurrency tests;
- three focused Company demonstration tests;
- deterministic two-tenant PGlite bootstrap;
- same-tenant listing and independent tenant uniqueness;
- cross-tenant find/update/delete denial equal to missing;
- stale-membership denial;
- migration chain and rollback regressions through `0006`;
- strict TypeScript and ESLint;
- real development startup;
- signed-out Worker, Company dashboard and Company tenant-scope redirects;
- database-backed runtime smoke;
- deterministic production build including `/company/tenant-scope`;
- standalone preview smoke;
- release manifest, generated handoff and evidence upload.

## Existing non-blocking warnings

The gate continues to report the previously recorded non-blocking environment/dependency warnings:

- two moderate PostCSS advisories below the configured high-severity failure threshold;
- the forced audit fix would move Next.js outside the locked dependency range and was not applied;
- npm `allow-scripts` review notice for `unrs-resolver`;
- no Next.js build cache on a clean runner;
- upstream GitHub Action Node/deprecation notices.

No functional, security, database, runtime, build, preview or handoff failure remains on the merged implementation.

## Generated owner handoff

Status:

```text
READY FOR MANUAL BROWSER TESTING
```

Exactly one visible workflow is required:

1. sign in to Company and complete TOTP;
2. open **Open tenant-scope demonstration** from the Company dashboard;
3. confirm masked tenant reference, membership role, synthetic-data warning and explicit empty/current-tenant records;
4. submit invalid/missing create values and confirm field validation without losing the page;
5. create one unique lowercase synthetic record and confirm it appears without manually refreshing;
6. edit it and confirm the new value/version appears without manually refreshing;
7. navigate to the Company dashboard and back to confirm persistence;
8. delete through the confirmation dialog and confirm success;
9. sign out, sign in as Worker, paste `/company/tenant-scope`, confirm Company content never appears and the Worker session remains usable;
10. stop the server normally and confirm clean synchronized Git state.

## Acceptance state

Subunit 4 is not owner-accepted yet.

Subunit 5 remains blocked until:

- the exact visible workflow passes;
- the development server stops cleanly;
- local `main` is clean and synchronized;
- no release-blocking owner defect remains;
- final owner acceptance is recorded.
