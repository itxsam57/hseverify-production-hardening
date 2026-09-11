# M1.04 Subunit 5 — Final Isolation Suite and Brick Acceptance

## Status

**DONE — OWNER PASS — 6 AUGUST 2026**

This final internal subunit closes M1.04 without adding a later business workflow or changing the accepted permission model, tenant repository contract, Company demonstration data model, or fixed-role portal design.

Final owner acceptance: `docs/testing/results/M1_04_FINAL_OWNER_ACCEPTANCE.md`

## Validated implementation evidence

- Pull request: `#34`
- Validated branch head: `a4634d10048315923b5c3cae65e1d6f88ededbe8`
- Validated PR merge candidate: `b8312e3d46cf35fc469fc39ffe6a2190ded44b21`
- PR workflow run: `31069538170`
- PR job: `92514406257`
- PR evidence artifact: `8955146532`
- Implementation merge: `4329a591dfa7d1e7c4fca3feb5dd33c873984574`
- Implementation merged-main run: `31069783616`
- Implementation merged-main job: `92515107222`
- Owner-tested control commit: `56973430099171ebc48d2f4cc96887b58486167b`
- Final control merged-main run: `31070230847`
- Final control merged-main job: `92516468358`
- Automated result: **PASS**
- Focused owner closure: **PASS**

## Accepted automated boundary

1. A complete six-role authorization matrix evaluates every active fixed portal role against every expected portal role. Six own-role cases pass and all thirty cross-role combinations fail through the central role-mismatch boundary.
2. Every accepted protected route is inventoried against one fixed role:
   - Worker dashboard, profile and onboarding;
   - Company dashboard and tenant-scope demonstration;
   - Assessor dashboard;
   - Verifier dashboard;
   - Admin dashboard and staff;
   - Root dashboard and staff.
3. The optimistic missing-cookie proxy covers every accepted protected route before App Router rendering. Database-backed authorization remains authoritative for every cookie-present request.
4. Real Next.js HTTP smoke requests all eleven accepted protected routes while signed out and requires the exact role login redirect without protected or not-found content.
5. Cross-tenant, missing and malformed fixture identifiers return the same non-enumerating result for find, update and delete. No separate existence oracle is exposed.
6. Trusted scope locking rejects mismatched tenant, membership, account and session identities.
7. Previously accepted Company authority is transactionally denied after session revocation, account disablement, tenant suspension, membership suspension, session active-role change, membership-role reduction or explicit permission denial.
8. The complete M1.04 migration stack proves deterministic application through `0006`, idempotency, rollback of `0006` then `0005`, preservation of M1.01–M1.03 data, clean reapplication, checksum validation and persistent PGlite close/reopen behavior.
9. `npm run test:m1-04-final` is permanent inside both the integration suite and the complete fail-closed application gate.

## Owner-visible closure accepted

Against commit `56973430099171ebc48d2f4cc96887b58486167b`, the owner confirmed:

1. migrations `0001` through `0006` applied with matching checksums;
2. signed-out `/worker/profile` redirected to `/worker/login?reason=session-required` before Worker or global not-found content appeared;
3. Company password and TOTP login succeeded;
4. a valid Company session received **Access Denied** for `/worker/profile` without Worker content;
5. **Return to active portal** preserved the Company session and dashboard;
6. sign-out and normal `Ctrl+C` shutdown passed;
7. Git status, diff check, protected configuration diff and synchronization state were clean;
8. final local HEAD matched the exact owner-tested commit.

The other signed-out routes, cross-role combinations, cross-tenant operations, lifecycle races and migration rollback/reapplication paths remain automated.

## Production change boundary

The only runtime source change in subunit 5 expanded the existing missing-cookie proxy matcher to accepted protected routes that previously depended on protected-layout rendering. It did not:

- trust cookies as authorization;
- accept role, tenant, membership, permission, ownership or scope from the browser;
- switch role or tenant inside a session;
- change central role or permission registries;
- weaken tenant SQL or transaction logic;
- add public Company registration, Company management, evidence, notifications, uploads, assessments, interviews, billing or payments.

## Rollback

- Application source rollback: revert implementation merge `4329a591dfa7d1e7c4fca3feb5dd33c873984574`.
- Schema rollback proof: the permanent suite demonstrates `0006` then `0005` rollback and clean reapplication in local/test PGlite.
- Preview and production destructive database rollback remains prohibited by the migration library.

## Final decision

Subunit 5 is **DONE — OWNER PASS**.

M1.04 — Authorization and Tenant Isolation is **DONE — OWNER PASS — 6 August 2026**.

M1.05 — Audit and Notification Foundations is now eligible and is the only permitted next implementation brick.