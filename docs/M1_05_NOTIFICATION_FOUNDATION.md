# M1.05 Subunit 3 — Persisted In-App Notifications and Role-Safe Deep Links

## Status

**DONE — OWNER PASS — 9 August 2026**

This subunit adds the real persisted in-app notification path required by M1.05. It deliberately does not add email delivery, later business-domain notification types, operational queue dashboards or M1.06+ behavior.

## Final accepted evidence

- Implementation pull request: `#41`.
- Final validated PR head: `5ba526d24ebf4788b1465b2f3d8780052eb51395`.
- Merge commit on `main`: `5f0b73e245044474713de54b9c7ae8642b771442`.
- Final PR engineering run: `31186076304`.
- Final PR validation job: `92890892172`.
- Merged-main engineering run: `31186344977`.
- Merged-main validation job: `92891735302`.
- Final PR complete result: **PASS**.
- Merged-main complete result: **PASS**.
- Owner visible hard test: **PASS — 9 August 2026**.
- Final acceptance record: `docs/testing/results/M1_05_NOTIFICATION_FOUNDATION_FINAL_OWNER_ACCEPTANCE.md`.

The owner reported the complete prescribed Subunit 3 handoff passed, including migration `0009`, focused and full application gates, real persisted Worker and Company notification flows, unread/read persistence, role-safe deep links, cross-role denial, responsive/keyboard behavior, restart persistence, clean shutdown and clean synchronized Git state.

## Implemented boundary

1. One shared `platform_notifications` store rather than separate per-portal stores.
2. Opaque notification IDs, fixed notification type vocabulary, schema-versioned bounded metadata and database-generated timestamps.
3. Every notification is bound to one recipient account and one fixed portal role; Company notifications also bind the trusted tenant and membership context.
4. Notifications are projected only from the accepted transactional outbox through the fixed `notification.portal.foundation` job type and server-only handler.
5. Projection uses a deterministic recipient-scoped SHA-256 projection key and database uniqueness so retry/reclaim cannot duplicate a logical notification.
6. Notification insert validation is enforced again at the database boundary: source job type, recipient account, role, tenant/membership, active eligibility, fixed content and metadata must all match.
7. All notification identity, source, recipient, content and target fields are immutable. Notification history cannot be deleted.
8. Read state is one-way (`unread -> read`) and the database supplies the trustworthy read timestamp.
9. List, unread-count, find and mark-read queries include direct recipient/role predicates; Company queries also include direct tenant/membership predicates.
10. Current live session/account/role and Company membership are revalidated before notification reads or mutations.
11. Cross-role, cross-account, cross-tenant, revoked and malformed notification lookups are non-enumerating.
12. The accepted outbox worker has one fixed notification projection handler; dynamic modules, URLs, SQL and browser-selected handler authority remain forbidden.
13. A shared persisted notification bell and unread count are present in all six authenticated fixed-role portals.
14. All six portals expose a real `/ROLE/notifications` page with explicit loading, empty and failure states.
15. The Worker dashboard no longer owns or renders demonstration notification data; its notification metric and recent list use the same persisted notification service as the bell.
16. Notification deep links use one fixed server-side target registry. The only Subunit 3 target is `portal.dashboard`, resolved through the accepted role-home registry.
17. Browser actions submit only the opaque notification ID. Role, tenant, membership, target and redirect destination are always derived server-side.
18. Opening a notification re-authorizes it against the current live role and scope before resolving its target.
19. Mark Read and denied deep-link operations write immutable audit facts through the accepted audit engine.
20. Notification projection writes its immutable audit fact in the same database transaction as the notification insert.
21. Development/test fixture creation is blocked in production and exercises the real accepted outbox transaction, real worker, real projection, real persistence and real authorization path.
22. The development/test fixture uses a server-generated unique fixture identity so repeated owner tests remain legitimate without weakening production idempotency.
23. Notification-center unread totals come from the authoritative scoped database count rather than being inferred from the bounded 50-record visible page.
24. Migration `0009_persisted_notifications` is deterministic and reversible while leaving already-recorded outbox/audit vocabulary monotonic so durable historical facts are not invalidated.
25. Permanent source, unit, PGlite integration, role/tenant isolation, route/deep-link, concurrent read, migration and persistence tests are wired into the complete engineering gate.

## Fixed initial notification type

The only production-shaped notification type registered in Subunit 3 is:

- `platform.foundation.ready`

Its only registered target is:

- `portal.dashboard`

This intentionally proves the notification architecture against routes that already exist. It does not invent M1.06+ business notifications merely to populate the UI.

## Delivery semantics

A notification is not considered created because an outbox job exists. The accepted outbox worker must process committed work and persist the recipient-scoped notification. If a worker crashes after projection but before final job completion, a later reclaim resolves the same projection key rather than creating a duplicate notification.

## Read-state semantics

- New notifications always begin unread.
- Read state may move only from unread to read.
- Duplicate/concurrent Mark Read requests result in only one database transition.
- Read timestamp and update timestamp are generated by the database.
- Marking a notification read does not alter its source, recipient, content or target.
- Notification history cannot be deleted to hide prior delivery state.

## Deep-link security model

A notification ID is a locator, not an authorization capability.

On every open action the server re-resolves the current authenticated principal, revalidates the session/account/role, revalidates Company tenant membership when applicable, finds the notification through recipient-scoped SQL, then resolves the fixed target using the current role. Missing, malformed, cross-role, cross-account, cross-tenant or revoked targets produce a safe local denial and do not reveal foreign record existence.

No arbitrary URL is stored in or accepted from a notification action.

## Validation repairs made permanent

The complete gate and review process exposed and permanently corrected:

- older migration-stack tests that assumed `0008` would remain permanently latest;
- an outbox migration test that depended on the globally latest migration rather than locating its own `0008` record;
- a route-security test whose broad source-order regex falsely classified a hard-coded role as query-controlled;
- a repeat-owner-test defect where a fixed development fixture idempotency key could resolve to an already-succeeded job;
- notification-center unread totals that could undercount when more than 50 unread records existed.

Each correction is represented by a permanent regression or structural test change rather than a one-off bypass.

## Explicit exclusions

- Durable email queue and email delivery-attempt records.
- Provider-neutral email delivery adapters or results.
- Live email provider credentials or activation.
- Business notification types for evidence, identity, invitations, assessments, interviews, credentials, billing or later unfinished modules.
- Admin/Root operational outbox or delivery dashboards.
- M1.06 or later product scope.

## Acceptance conclusion

All Subunit 3 implementation, exact PR-head automation, merged-main automation and owner-visible hard-test gates passed. Subunit 3 is **DONE**.

The overall M1.05 brick remains **IN PROGRESS**. The next permitted build unit is **M1.05 Subunit 4 — Durable Email Queue, Delivery Attempts and Local/Test Provider Adapter**.