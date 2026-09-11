# M1.05 Final Acceptance — Automated Validation Pending Owner

## Status

**AUTOMATED IMPLEMENTATION PASS — MERGE AND OWNER PASS PENDING**

M1.05 Subunit 5 has a validated implementation candidate, but M1.05 is **not DONE**. The exact final documentation head must pass again, merge to `main`, merged `main` must pass, and the owner must complete the final command-line hard test before a separate brick-level closure record can be written.

## Validated implementation candidate

- Pull request: `#45`
- Branch: `build/m1-05-final-acceptance`
- Base: `101f93a0c6a91ef014efdef94fb5f9a9a50ac9aa`
- Strengthened validated implementation head: `724f7b5d8701a045837ffdb870f63ab804ff9958`
- Engineering run: `31320790608`
- Validation job: `93263363256`
- Complete engineering gate: **PASS**

The validated implementation includes the final combined isolation/integrity/persistence suite, the mixed notification/email concurrency and crash-recovery suite, the six-fixed-role recipient isolation matrix, the semantic source/authority guard and permanent regression `REG-035`.

## Automated proof completed

The complete gate has proved, together with all accepted M1.05 subsystem regressions:

- one canonical immutable audit store and append-only history;
- one canonical transactional outbox/job worker with deterministic claim/lease/reclaim/retry/terminal behavior;
- one canonical persisted notification store with role/tenant isolation, durable one-way read state and reauthorized fixed deep links;
- one canonical durable email-delivery store with immutable attempt history, provider-neutral results and `local_test` adapter only;
- Company tenant A/B non-enumerating isolation across audit, outbox, notification and email records;
- Worker/Company/Assessor/Verifier/Admin/Root notification and email recipient isolation;
- revoked membership/session denial without deleting durable history;
- state+required-outbox rollback/commit atomicity;
- outbox/notification/email duplicate suppression;
- mixed notification/email `SKIP LOCKED` concurrency, expired-lease reclaim and stale completion denial;
- no duplicate logical notification/email effect after reclaim;
- accepted retry/backoff/fifth-attempt terminal behavior through existing outbox/email real-runtime regressions;
- audit/notification/email mutation/deletion rejection at the database boundary;
- no plaintext recipient email in accepted outbox/audit/email durable state;
- local/test provider cannot perform arbitrary network/provider selection;
- complete-stack migration checksum validation and state persistence through PGlite close/reopen;
- owned-layer deterministic migration rollback/reapply regressions for M1.05 migrations;
- strict TypeScript, ESLint, dependency/security gate, development/runtime smoke and production build.

## Defects discovered during Subunit 5

### REG-035 — semantic source guard, not guessed source spelling

Early final source checks produced false failures by guessing internal symbol names or matching an unsafe substring. The product boundary itself was sound. The permanent guard now checks stable semantics: actual durable terminal short-circuits, principal-scoped notification lookup plus fixed `resolveNotificationHref`, exact `local_test` provider authority, explicit fixed worker adapters and word-bounded provider checks.

### REG-033 applied again — final-suite fixtures must obey lower-layer lifecycle invariants

The combined acceptance test initially attempted incomplete session-revocation and outbox-terminal fixture transitions. Existing database constraints correctly rejected them. The fixtures were corrected to use the complete accepted lifecycle shape; no product/database constraint was relaxed.

## Scope review

Subunit 5 adds no new product feature, database migration, dependency, route, browser workflow, notification type, email business type or live provider.

M1.06 secure storage/upload and every later milestone remain blocked.

## Remaining gates

1. Final documentation/governance head passes the complete PR engineering gate.
2. PR #45 remains scope-clean, mergeable, without head drift or unresolved review threads.
3. Exact final head merges to `main`.
4. Merged `main` passes the complete engineering gate.
5. Owner runs `docs/testing/M1_05_FINAL_ACCEPTANCE_HARD_TEST.md` and reports PASS.
6. Separate final M1.05 brick owner-acceptance record merges and its merged-main gate passes.

Only after step 6 may M1.05 be marked **DONE — OWNER PASS** and M1.06 become **READY TO BUILD**.
