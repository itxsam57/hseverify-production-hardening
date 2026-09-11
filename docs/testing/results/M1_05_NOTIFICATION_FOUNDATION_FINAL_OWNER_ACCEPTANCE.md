# M1.05 Subunit 3 — Final Owner Acceptance

## Decision

**DONE — OWNER PASS — 9 August 2026**

M1.05 Subunit 3, Persisted In-App Notifications and Role-Safe Deep Links, is accepted.

This acceptance applies only to Subunit 3. The overall M1.05 Audit and Notification Foundations brick remains **IN PROGRESS** until durable email delivery and the final combined M1.05 isolation/retry/owner acceptance are completed.

## Accepted implementation evidence

- Implementation pull request: `#41`
- Final validated PR head: `5ba526d24ebf4788b1465b2f3d8780052eb51395`
- Merge commit on `main`: `5f0b73e245044474713de54b9c7ae8642b771442`
- Final PR engineering run: `31186076304`
- Final PR validation job: `92890892172`
- Merged-main engineering run: `31186344977`
- Merged-main validation job: `92891735302`
- Final PR complete engineering gate: **PASS**
- Merged-main complete engineering gate: **PASS**
- Owner visible hard test: **PASS — 9 August 2026**
- Owner reported the complete prescribed Subunit 3 handoff passed, including local migration `0009`, focused notification checks, full application gate, real persisted Worker and Company notification flows, unread/read persistence, role-safe deep links, cross-role denial, responsive/keyboard checks, restart persistence, clean shutdown and final Git synchronization checks.

## Accepted capability boundary

The accepted notification foundation provides:

1. one canonical persisted `platform_notifications` store shared across all fixed portals;
2. opaque notification IDs, fixed type vocabulary, bounded schema-versioned metadata and database timestamps;
3. exact recipient-account and fixed-role binding, with trusted tenant/membership binding for Company notifications;
4. notification creation only from committed accepted outbox work through fixed server-side handler `notification.portal.foundation`;
5. recipient-scoped deterministic projection keys and database uniqueness for retry/reclaim duplicate suppression;
6. database validation that source job, recipient, role, tenant/membership, fixed content, metadata and current eligibility agree;
7. immutable notification identity, source, recipient, content and target fields with deletion rejection;
8. one-way durable unread-to-read state with database-generated read timestamps;
9. directly scoped list, count, find and mark-read queries, including direct Company tenant/membership SQL predicates;
10. live session/account/role revalidation and live Company membership revalidation before reads, mutations and deep-link resolution;
11. non-enumerating denial for cross-role, cross-account, cross-tenant, revoked and malformed notification access;
12. one shared persisted notification bell and unread count across Worker, Company, Assessor, Verifier, Admin and Root portals;
13. real role-local notification pages with loading, empty, success and failure states;
14. Worker dashboard notification metrics and recent records backed by the persisted notification service rather than demonstration state;
15. one fixed server-side deep-link registry whose Subunit 3 target is the already-real `portal.dashboard` route resolved from current role authority;
16. browser actions that submit only an opaque notification ID while role, tenant, membership, target and redirect destination remain server-derived;
17. reauthorization at notification open time so a stored notification never becomes an authorization capability;
18. duplicate/concurrency-safe Mark Read with immediate visible state/count update and durable restart persistence;
19. immutable audit facts for notification projection, read transition and denied deep-link access;
20. development/test fixture creation that is production-disabled and exercises the same accepted outbox, worker, projection, persistence and authorization path;
21. deterministic reversible migration `0009_persisted_notifications` with close/reopen persistence proof and preserved historical outbox/audit vocabulary;
22. permanent source, unit, PGlite integration, role/tenant isolation, route/deep-link, concurrency, migration and complete-gate regressions.

## Permanent regression decisions

The following defects found during Subunit 3 validation are permanent regressions:

- older migration-stack tests assuming `0008` would remain permanently latest;
- an outbox migration proof coupled to the globally newest migration rather than explicitly owning `0008`;
- an over-broad route-security regex that treated source order as query-controlled role authority;
- a fixed development-fixture idempotency key that made a second legitimate owner test unreliable;
- notification-center unread totals inferred from a bounded page instead of the authoritative persisted unread count.

During the final owner-acceptance closure on 9 August 2026, the unchanged application was additionally blocked by a newly reviewed high-severity Nano ID advisory. The repository was locked at transitive `nanoid 3.3.16`; GitHub's reviewed advisory identifies `3.3.17` as the first patched 3.x version. The closure therefore pins `nanoid 3.3.17`, regenerates only the affected lock entry, and permanently records `3.3.17` as the minimum accepted Nano ID security floor. The production audit gate was not weakened or bypassed.

These controls must not be weakened by later M1.05 work.

## Explicitly not accepted by this record

This record does not claim completion of:

- durable email queue records;
- email delivery-attempt records;
- provider-neutral email delivery result mapping;
- local/test email delivery adapters;
- live email provider credentials or activation;
- final combined M1.05 adversarial isolation/retry/recovery proof;
- final M1.05 brick-level owner sign-off;
- M1.06 or later milestones.

## Next permitted build unit

**M1.05 Subunit 4 — Durable Email Queue, Delivery Attempts and Local/Test Provider Adapter.**

Subunit 4 may build only on the accepted audit, outbox and notification foundations. It must not weaken their authorization, tenant isolation, audit immutability, idempotency, retry, persistence or dependency-security guarantees, and it must not pull Subunit 5 or M1.06+ scope forward.