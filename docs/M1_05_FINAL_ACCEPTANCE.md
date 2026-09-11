# M1.05 — Audit and Notification Foundations

## Status

**DONE — OWNER PASS — 9 August 2026**

M1.05 has completed its five internal subunits, exact-head implementation gate, merged-main gate and final owner command-line acceptance. This status becomes canonical on `main` when the separate owner-acceptance closure PR containing this record merges and its merged-main engineering gate passes.

## Final accepted evidence

- Final implementation pull request: `#45`
- Final validated PR head: `e581ec92400f47f06f66eb3ad17f912fa0d7982e`
- Final PR engineering run: `31321141113`
- Final PR validation job: `93264217778`
- Implementation merge commit: `dada64848d683cde4359fdb02efe704f37332a2a`
- Merged-main engineering run: `31321380167`
- Merged-main validation job: `93264799262`
- Owner final command-line hard test: **PASS — 9 August 2026**
- Final owner-acceptance record: `docs/testing/results/M1_05_FINAL_OWNER_ACCEPTANCE.md`

## Accepted subunits

1. Immutable Audit Domain, Schema and Append-Only Repository Foundation — **DONE — OWNER PASS**.
2. Transactional Outbox and Deterministic Job Foundation — **DONE — OWNER PASS**.
3. Persisted In-App Notifications and Role-Safe Deep Links — **DONE — OWNER PASS**.
4. Durable Email Queue, Delivery Attempts and Local/Test Provider Adapter — **DONE — OWNER PASS**.
5. Complete M1.05 Isolation, Retry, Migration and Owner Acceptance — **DONE — OWNER PASS**.

## Accepted brick boundary

The accepted M1.05 architecture now provides one authoritative foundation for:

- immutable append-only platform audit events and bounded authorized reads;
- transactional outbox jobs with server-derived idempotency, deterministic lease/reclaim, retry/backoff and terminal failure;
- persisted in-app notifications with exact recipient/fixed-role/Company scope, durable one-way read state and server-resolved role-safe deep links;
- durable email-delivery state with immutable attempt history, provider-neutral normalized results and deterministic `local_test` delivery;
- direct tenant/recipient SQL predicates and non-enumerating cross-role/cross-tenant denial;
- six-role Worker/Company/Assessor/Verifier/Admin/Root notification/email isolation;
- revoked membership/session denial without deleting durable history;
- state plus required-outbox atomicity and idempotent durable effects under at-least-once execution;
- mixed notification/email worker concurrency, expired-lease reclaim and stale-worker denial;
- deterministic migration `0007`–`0010` checksum, rollback/reapply and persistent close/reopen proof;
- permanent regressions through `REG-035` and full repository CI protection.

## Security and authority limits

- The browser never chooses actor, role, tenant, membership, provider, retry or executable handler authority.
- Notification deep links are not authorization capabilities; access is revalidated when opened.
- M1.05 does not claim exactly-once external delivery.
- No plaintext recipient email is persisted in the accepted outbox/audit/email-delivery result path.
- Live SMTP/API credentials remain intentionally disabled; `local_test` is the only accepted email provider adapter in this brick.
- Failed asynchronous notification/email work cannot roll back accepted core state.

## Scope exclusions preserved

M1.05 does not implement secure object storage/evidence upload, worker identity evidence/liveness, company verification, sites/departments/team, worker invitations/codes, qualification/experience/skill evidence workflows, public verification, assessments, interviews, credentials, billing or later milestone workflows.

## Next brick

After this separate closure record merges and its merged-main gate passes, Phase 1 advances to **5 of 12 Milestone 1 bricks DONE** and **M1.06 Secure Storage and Upload Pipeline** becomes the only permitted implementation brick.
