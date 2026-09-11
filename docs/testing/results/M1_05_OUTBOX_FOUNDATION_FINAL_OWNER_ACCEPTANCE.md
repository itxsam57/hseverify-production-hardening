# M1.05 Subunit 2 — Final Owner Acceptance

## Decision

**DONE — OWNER PASS — 7 August 2026**

M1.05 Subunit 2, Transactional Outbox and Deterministic Job Foundation, is accepted.

This acceptance applies only to Subunit 2. The overall M1.05 Audit and Notification Foundations brick remains **IN PROGRESS** until persisted notifications, role-safe deep links, durable email delivery, final isolation/retry proof and the complete M1.05 owner gate are accepted.

## Accepted implementation evidence

- Implementation pull request: `#39`
- Final validated PR head: `11ad5aff8cb737c00884e5820b24dc73fddf180a`
- Merge commit on `main`: `d03155f41c11ba4a5b597e870bc0f54036359807`
- Merged-main engineering run: `31109232531`
- Merged-main validation job: `92642347886`
- Merged-main complete engineering gate: **PASS**
- Owner hard test: **PASS — 7 August 2026**
- Owner reported the complete prescribed command-line handoff passed, including focused outbox checks, full application gate, migration `0008` rollback/reapply, checksum verification and final Git synchronization checks.

## Accepted capability boundary

The accepted foundation provides:

1. one canonical durable outbox/background-job model with fixed server-side job registration;
2. opaque job, attempt, worker and lease identifiers;
3. fixed schema-versioned and bounded payload validation;
4. trusted account/tenant-scoped deterministic idempotency with database uniqueness;
5. transaction-bound accepted state, required outbox work and immutable audit facts;
6. durable pending, leased, retry-wait, succeeded and terminal-failed lifecycle states;
7. durable attempt history without cleanup-by-deletion;
8. concurrent `FOR UPDATE SKIP LOCKED` claiming;
9. lease expiry, reclaim and stale-worker completion rejection;
10. deterministic bounded retry/backoff and terminal-failure behavior;
11. safe bounded persisted error information rather than raw thrown errors;
12. immutable lifecycle audit facts for enqueue, claim, reclaim, success, retry and terminal failure;
13. trusted tenant context for tenant-owned job lifecycle facts;
14. authorized bounded platform and direct-tenant-SQL operational query contracts;
15. reversible migration `0008_transactional_outbox_jobs` with close/reopen persistence proof;
16. permanent regression coverage for atomic rollback, duplicate suppression, concurrency, lease expiry, stale completion, retry, terminal failure and migration-stack compatibility.

## Delivery semantics

The accepted contract is **at-least-once execution with idempotent outcomes**. It does not claim exactly-once transport.

## Permanent regression decisions

The following defects discovered during Subunit 2 validation are treated as permanent regressions:

- account/tenant idempotency collisions;
- rollback behavior that could invalidate immutable lifecycle audit facts;
- copyable marker-only actor/worker/lease authority;
- missing trusted tenant context in background lifecycle audits;
- arbitrary claim scan limits that could strand eligible work;
- older migration-stack tests assuming `0007` was permanently latest.

These controls must not be weakened by later M1.05 work.

## Explicitly not accepted by this record

This record does not claim completion of:

- persisted user-visible notifications;
- unread/read notification state;
- notification bell/count behavior;
- role-safe notification deep links;
- business-event notification projection handlers;
- durable email queue/provider delivery attempts;
- local/test or live email delivery adapters;
- operational notification/email dashboards;
- M1.05 final completion;
- M1.06 or later milestones.

## Next permitted build unit

**M1.05 Subunit 3 — Persisted In-App Notifications and Role-Safe Deep Links.**

Subunit 3 may build only on the accepted immutable audit and outbox foundations. It must not bypass them or pull the email-delivery subunit forward.