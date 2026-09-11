# M1.05 Subunit 2 — Transactional Outbox and Deterministic Job Foundation

## Status

**DONE — OWNER PASS — 7 August 2026**

This subunit adds only the durable transactional outbox and deterministic background-job foundation. It does not add visible notification records, notification pages, deep links, email delivery records, provider adapters or operational dashboards.

## Final accepted evidence

- Implementation pull request: `#39`.
- Final validated PR head: `11ad5aff8cb737c00884e5820b24dc73fddf180a`.
- Merge commit on `main`: `d03155f41c11ba4a5b597e870bc0f54036359807`.
- Merged-main engineering run: `31109232531`.
- Merged-main validation job: `92642347886`.
- Complete merged-main result: **PASS**.
- Owner command-line hard test: **PASS — 7 August 2026**.
- Final acceptance record: `docs/testing/results/M1_05_OUTBOX_FOUNDATION_FINAL_OWNER_ACCEPTANCE.md`.

The owner reported the complete prescribed handoff passed, including focused outbox checks, the full application gate, migration `0008` rollback/reapply, checksum verification and final Git synchronization checks.

## Implemented boundary

1. One fixed outbox/job domain with a single server-side type registry.
2. Opaque job, attempt, lease and worker identifiers backed by non-copyable trusted capabilities.
3. Schema-versioned payloads with a fixed per-type validator and 8 KB ceiling.
4. Server-derived SHA-256 idempotency keys scoped by trusted account or tenant context, plus database uniqueness.
5. Transactional enqueue support that requires at least one durable outbox result before an accepted operation may commit.
6. Enqueue audit facts written through the accepted immutable audit repository in the same transaction.
7. Durable pending, leased, retry-wait, succeeded and terminal-failed states.
8. Separate durable attempt history with running, succeeded, retry-scheduled, terminal-failed and lease-expired outcomes.
9. Concurrent claim SQL using row locks and `SKIP LOCKED`.
10. Opaque lease ownership, expiry, reclaim and stale-completion rejection.
11. Five-attempt ceiling with deterministic server-controlled retry delays of 5, 30, 120 and 600 seconds.
12. Fixed server-only handler registration; no browser-selected handler, module, SQL, URL or arbitrary code execution.
13. Safe failure codes and bounded summaries; raw thrown errors are not persisted.
14. Database-level rejection of job and attempt deletion.
15. Authorized bounded platform and tenant query contracts with direct tenant SQL predicates and non-enumerating invalid identifiers.
16. Job enqueue, claim, reclaim, success, retry and terminal-failure audit actions, including trusted tenant context for tenant jobs.
17. Migration, rollback/reapply, persistence, atomicity, duplicate suppression, concurrency, lease-expiry, stale-worker, retry and terminal-failure tests.
18. Permanent source, unit, integration and complete-gate wiring.

## Delivery semantics

The foundation intentionally provides **at-least-once execution with idempotent outcomes**. It does not claim exactly-once transport. A job may be reclaimed after a crashed worker lease expires, while stale workers are prevented from completing or changing the job after ownership moves.

## Rollback and immutable audit history

Migration `0008_transactional_outbox_jobs` removes the outbox job and attempt stores when rolled back, but it does not delete or invalidate immutable lifecycle audit facts already written by the accepted audit engine. The expanded audit action and `job` target vocabulary therefore remains monotonic during a destructive storage rollback. Reapplication replaces the same constraints deterministically.

## Fixed initial handler

The only registered job type in this subunit is:

- `platform.foundation.noop`

It exists solely to validate the durable worker contract without pulling notification or email business behavior forward. Later job types require an explicit reviewed migration, fixed payload schema, fixed handler registration and regression coverage.

## Permanent validation regressions

The full gate exposed older migration-stack tests that assumed migration `0007` would remain permanently latest. The platform, authentication, authorization, complete M1.04, audit and Worker registration rollback proofs were extended through `0008` while preserving their original guarantees and accepted data.

The architecture review also permanently corrected:

- cross-account and cross-tenant idempotency collisions;
- rollback behavior that could invalidate immutable lifecycle audit facts;
- copyable marker-only actor, worker and lease authority;
- lost tenant context in background lifecycle audit facts;
- an arbitrary claim scan ceiling that could leave eligible work unprocessed.

Later work must preserve these regressions.

## Explicit exclusions

- User-visible notification persistence and read state.
- Notification center, badge or deep-link UI.
- Notification projection handlers.
- Email queue or provider delivery attempts.
- Live provider credentials or activation.
- Admin/Root queue dashboards.
- M1.06 or later workflows.

## Acceptance conclusion

All Subunit 2 implementation, PR, merged-main automation, rollback/reapply and owner hard-test gates passed. Subunit 2 is **DONE**.

The overall M1.05 brick remains **IN PROGRESS**. The next permitted build unit is **M1.05 Subunit 3 — Persisted In-App Notifications and Role-Safe Deep Links**.