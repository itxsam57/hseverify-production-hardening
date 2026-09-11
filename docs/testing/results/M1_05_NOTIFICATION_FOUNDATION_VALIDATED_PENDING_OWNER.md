# M1.05 Subunit 3 — Persisted Notifications Validation Record

## Status

**FUNCTIONAL AUTOMATED PASS — FINAL DOCUMENTATION GATE / MERGE / OWNER PASS PENDING**

This record captures the complete automated validation of the functional implementation before the final documentation-only commits.

## Candidate evidence

- Implementation pull request: `#41`
- Functional implementation head: `35158a9fdfa2596d45febeca80996bf539aad41b`
- Engineering verification run: `31185529169`
- Validation job: `92888980538`
- Evidence artifact: `8989374984`
- Artifact digest: `sha256:4de0d4215be72521361351159249aba041e70512cd5a2a1c1b85b9256e99e677`
- Complete engineering result: **PASS**

## Automated proof completed

The passing complete gate includes:

- fixed notification source/security contract checks;
- notification domain unit tests;
- persisted PGlite notification integration tests;
- outbox-bound projection and duplicate suppression;
- immutable notification content/history and one-way read state;
- concurrent Mark Read behavior;
- exact recipient/account/role SQL scope;
- two-Company-tenant isolation and revoked-membership denial;
- malformed/cross-role/cross-tenant non-enumerating access;
- fixed role-safe dashboard deep-link contract for all six portals;
- route actions accepting only an opaque notification ID;
- rollback/reapply proof for migration `0009`;
- close/reopen persistence proof;
- accepted M1.01–M1.05 Subunit 2 migration and behavior regressions;
- Worker registration and authentication regressions;
- TypeScript and lint;
- development runtime smoke;
- signed-out portal redirects;
- real application PGlite runtime smoke;
- production build.

## Defects found during validation and permanently regressed

1. Older migration tests treated `0008` as permanently latest. Every affected independent proof was extended through `0009`; the outbox-specific migration test now locates its own migration by ID so future layers cannot break it merely by existing.
2. A notification route-security regex was broad enough to treat hard-coded role props as query-controlled authority. It now detects actual `searchParams` role authority precisely.
3. The first development fixture key was fixed, so a second legitimate owner test could resolve to an already-succeeded job. The fixture now receives a server-generated unique identity while real notification projection remains database-idempotent.
4. The notification center initially inferred unread total from its bounded visible page. It now uses the authoritative recipient-scoped database unread count, with a permanent source regression preventing a return to page-derived totals.

## Scope exclusions preserved

No email queue, email delivery attempts, provider adapter, live email integration, later business notification type, operational queue dashboard or M1.06+ workflow was added.

## Remaining required gates

1. The final documentation PR head must pass the same complete engineering gate.
2. PR `#41` must merge without head drift.
3. The exact merged `main` commit must pass the complete push gate.
4. The visible owner hard test in `docs/testing/M1_05_NOTIFICATION_FOUNDATION_HARD_TEST.md` must pass.
5. Git must be clean and synchronized.
6. A final Subunit 3 owner-acceptance record must merge before Subunit 3 becomes DONE.

Subunit 4 remains blocked until those gates are complete.
