# M1.05 Subunit 4 — Final Owner Acceptance

## Decision

**DONE — OWNER PASS — 9 August 2026**

M1.05 Subunit 4, Durable Email Queue, Delivery Attempts and Local/Test Provider Adapter, is accepted.

This acceptance applies only to Subunit 4. The overall M1.05 Audit and Notification Foundations brick remains **IN PROGRESS** until Subunit 5 completes the combined isolation, retry/recovery, migration and final M1.05 owner-acceptance gate.

## Accepted implementation evidence

- Implementation pull request: `#43`
- Final validated PR head: `d370dc787f59eba9e7914303d8c361f95e553e88`
- Final PR engineering run: `31316893556`
- Final PR validation job: `93253530340`
- Owner-tested merge commit on `main`: `de1487739731edc124e176b043d0094d4f19175b`
- Merged-main engineering run: `31317102908`
- Merged-main validation job: `93254018966`
- Final PR complete engineering gate: **PASS**
- Merged-main complete engineering gate: **PASS**
- Owner command-line hard test: **PASS — 9 August 2026**
- Owner reported that every prescribed section passed: synchronized `main`, locked dependency install, migrations `0001`–`0010`, focused email-delivery checks, real local/test runtime delivery scenarios, the full application regression gate, rollback of only migration `0010`, clean reapplication through `0010`, clean Git/configuration diffs, and identical local/origin `main` commit state.

## Accepted capability boundary

The accepted email-delivery foundation provides:

1. one canonical durable `platform_email_deliveries` model and separate immutable delivery-attempt history;
2. one fixed outbox job type, `email.delivery.foundation`, using the already-accepted transactional outbox worker rather than a competing scheduler;
3. transactional queue creation with required outbox work;
4. trusted server-side recipient, role and optional Company tenant/membership derivation;
5. no plaintext recipient address persisted in outbox payload, delivery/attempt history, immutable audit metadata or normalized provider results;
6. SHA-256 recipient-address fingerprinting for durable correlation;
7. opaque delivery/attempt identifiers, deterministic dispatch keys and hashed provider references;
8. exact active outbox worker/lease binding before an email attempt may start or finish;
9. durable queued, processing, retry-wait, delivered and terminal-failed logical states;
10. append-only delivery-attempt history;
11. provider-neutral normalized success/retry/terminal result contracts with bounded safe metadata;
12. a deterministic `local_test` adapter restricted to development/test and performing no network call;
13. real runtime proof through the actual outbox repository, email repository, email handler, local/test adapter, immutable audit path and PGlite database;
14. directly scoped recipient/role/Company-tenant reads with live session, authorization and membership revalidation;
15. non-enumerating cross-role, cross-account, cross-tenant, revoked and malformed access denial;
16. immutable email queued, attempt-started, delivered, retry-scheduled and terminal-failed audit facts;
17. inherited at-least-once job execution with idempotent durable email outcomes rather than a false exactly-once transport claim;
18. duplicate-dispatch suppression after durable delivered or terminal state;
19. stale-worker start/finalize rejection after lease expiry or reclaim;
20. inherited deterministic bounded retry/backoff with fifth-attempt terminal failure and no second retry authority;
21. persistence through database close/reopen;
22. deterministic reversible migration `0010_email_delivery_foundation` preserving accepted prior M1.05 history and data;
23. permanent source, unit, platform, real-runtime, migration, persistence, isolation and complete-gate regressions.

## Permanent regression decisions

The following defects discovered during Subunit 4 are permanent regressions and remain protected:

- `REG-027` — migration proofs must own their migration rather than assume it remains repository-wide latest;
- `REG-028` — stale or reclaimed email leases cannot start or finalize work;
- `REG-029` — re-entry cannot duplicate attempt-start audit facts;
- `REG-030` — reclaimed jobs cannot redispatch already delivered or terminal email state;
- `REG-031` — runtime-test compiler/module semantics cannot diverge from the application contract;
- `REG-032` — PostgreSQL attempt-number parameters must remain type-coherent across `INTEGER` and `SMALLINT` boundaries;
- `REG-033` — higher-layer fixtures cannot bypass or contradict accepted lower-layer invariants;
- `REG-034` — the shared worker lease argument must be explicitly adapted so notification dependency injection and email lease authority cannot collide.

These controls must not be weakened by Subunit 5 or later milestones.

## Explicitly not accepted by this record

This record does not claim completion of:

- live SMTP or email API sending;
- production provider credentials or provider activation;
- arbitrary provider URLs/modules selected from browser input;
- business-domain email templates or later workflow email types;
- an email operations dashboard;
- SMS delivery;
- final combined M1.05 adversarial isolation/retry/recovery proof;
- final M1.05 brick-level owner sign-off;
- M1.06 or later milestones.

## Next permitted build unit

**M1.05 Subunit 5 — Complete M1.05 Isolation, Retry, Migration and Owner Acceptance.**

Subunit 5 is the only permitted next implementation scope. It must test and close the accepted audit, outbox, notification and email-delivery foundations together without inventing new product-domain behavior or pulling M1.06+ scope forward.