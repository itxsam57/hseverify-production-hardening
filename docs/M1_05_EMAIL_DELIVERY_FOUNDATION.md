# M1.05 Subunit 4 — Durable Email Queue, Delivery Attempts and Local/Test Provider Adapter

## Status

**DONE — OWNER PASS — 9 August 2026**

Subunit 4 is formally accepted. The overall M1.05 Audit and Notification Foundations brick remains **IN PROGRESS** until Subunit 5 completes the final combined M1.05 acceptance gate.

This subunit adds only the durable email-delivery foundation on top of the accepted M1.05 audit, transactional outbox/job and persisted-notification foundations. It does not activate a live SMTP/API provider, add provider credentials, introduce later business-domain email templates, create an operational email dashboard or enter M1.06 scope.

## Accepted implementation evidence

- Implementation pull request: `#43`
- Final validated PR head: `d370dc787f59eba9e7914303d8c361f95e553e88`
- Final PR engineering run: `31316893556`
- Final PR validation job: `93253530340`
- Owner-tested merge commit on `main`: `de1487739731edc124e176b043d0094d4f19175b`
- Merged-main engineering run: `31317102908`
- Merged-main validation job: `93254018966`
- Complete PR gate: **PASS**
- Complete merged-main gate: **PASS**
- Owner command-line hard test: **PASS — 9 August 2026**
- Final acceptance record: `docs/testing/results/M1_05_EMAIL_DELIVERY_FOUNDATION_FINAL_OWNER_ACCEPTANCE.md`

## Accepted boundary

1. Migration `0010_email_delivery_foundation` creates one durable logical delivery store and one immutable delivery-attempt history.
2. Fixed outbox type `email.delivery.foundation` uses the accepted outbox worker, lease, retry, reclaim and terminal-failure engine rather than adding a second scheduler.
3. Queue creation and required outbox work commit transactionally.
4. Recipient identity, role and optional Company tenant/membership scope are derived from trusted server state.
5. The verified recipient address is resolved server-side for dispatch and is not persisted in outbox payload, delivery/attempt history, immutable audit metadata or normalized provider result.
6. The delivery store persists only a SHA-256 recipient-address fingerprint for durable correlation.
7. Delivery and attempt identifiers, dispatch keys and provider-reference hashes are server-derived opaque values.
8. Delivery attempts are bound to the exact live outbox worker and lease before they may start or finish.
9. Logical delivery state preserves queued, processing, retry-wait, delivered and terminal-failed outcomes while attempt history remains append-only.
10. Provider results are normalized into fixed success/retry/terminal contracts with bounded safe result codes and summaries.
11. The deterministic `local_test` adapter is permitted only in development/test and performs no network call.
12. Real runtime regressions invoke the actual outbox repository, email repository, email handler, local/test adapter, immutable audit writes and PGlite database together.
13. Recipient/role/Company-tenant reads use direct SQL scope plus live authorization/session/membership revalidation and non-enumerating misses.
14. Email queued, attempt-started, delivered, retry-scheduled and terminal-failed lifecycle facts use the accepted immutable audit engine.
15. Migration `0010` is reversible and reapplicable without invalidating accepted prior M1.05 data/history.

## Delivery semantics

The email foundation inherits the accepted outbox model: **at-least-once job execution with idempotent durable outcomes**. It does not claim exactly-once external transport.

A worker crash may cause an outbox lease to be reclaimed. The email layer checks durable delivery state before dispatch and binds each attempt to the exact active lease so a stale worker cannot start or finalize work after ownership changes. A delivery already durably marked delivered or terminally failed is not dispatched again when the surrounding outbox job is reclaimed.

## Accepted real-path scenarios

Permanent automated/runtime proof covers:

- successful local/test delivery;
- one retry followed by success;
- fifth-attempt terminal failure;
- lease expiry and replacement-worker continuation;
- stale-worker start/finalize rejection;
- no duplicate dispatch after durable delivered/terminal state;
- immutable attempt and audit history;
- persistence through PGlite close/reopen;
- no plaintext recipient address in persisted delivery/attempt/audit state;
- direct recipient/role/Company-tenant isolation;
- deterministic rollback and reapplication of migration `0010`.

## Permanent regressions discovered during this build

- `REG-027` — migration proof coupled to globally latest migration.
- `REG-028` — stale/reclaimed email lease could start or finish work.
- `REG-029` — duplicate attempt-start audit on re-entry.
- `REG-030` — redispatch after durable terminal email state.
- `REG-031` — runtime test compiler semantics diverged from the application.
- `REG-032` — PostgreSQL parameter inferred as both `INTEGER` and `SMALLINT`.
- `REG-033` — higher-layer fixtures violated accepted lower-layer invariants.
- `REG-034` — shared outbox lease collided with notification dependency injection.

The permanent executable/source guards and the central regression register must remain intact during Subunit 5 and later work.

## Explicit exclusions

- Live SMTP or email API provider.
- Provider secrets or production credentials.
- Arbitrary provider URL/module/browser-selected transport.
- User-visible email queue or operations dashboard.
- Business workflow email templates/types from later bricks.
- SMS delivery.
- Final combined M1.05 Subunit 5 acceptance.
- M1.06 secure storage/upload work or any later milestone.

## Next gate

**M1.05 Subunit 5 — Complete M1.05 Isolation, Retry, Migration and Owner Acceptance** is the only permitted next implementation unit.

The exact current scope is defined by `docs/NEXT_BUILD_UNIT.md`.