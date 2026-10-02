> Current authority (2026-10-02): use `itxsam57/hseverify-production-hardening` / `qa/masterplan-completion-20260926`. See [workflow audit](qa/2026-10-02-workflow-audit.md). Earlier gate/branch entries below are historical; they are not current production acceptance.

# Next Build Unit

## Current hardening mission — 11 September 2026

The owner explicitly superseded the earlier single-brick execution restriction with
`.codex-governor/mission.md`, on branch `codex/hseverify-full-hardening-20260911`
only. Preserve M1.01–M1.07; hard-reverify M1.08 onward against the canonical
masterplan, then complete remaining M2/M3 requirements in order. Do not merge or
push main. Historical owner acceptance is not inferred from automated tests.

Repository evidence at base `b8fd9609284bea8b52a6bcb159f208796ff6480f`:
M2.08 implementation was merged in `648af16` and closure recorded in `858c237`.
Its production modules are in `src/lib/assessment-attempt/`, migration `0043`,
and permanent runtime/browser tests are wired through `test:m2-08` and
`scripts/m2-08-browser-qa.mjs`. Thus “M1.12 only” and “M2.08 not built” below
are historical execution statements, superseded for this mission.

Existence is not full canonical completion: M2.08's historical acceptance excludes
replacement forms, device binding and an INTERRUPTED lifecycle. These remain
repository work under masterplan sections 16, 35 and 36. The mission ledger retains
ACTIONABLE status until current implementation and rendered workflow evidence
close each requirement. Provider absence alone never closes missing local code.


## Authority

This is the exact current implementation gate for the HSE Verify Phase 1 clean rebuild. Canonical frozen product/engineering authority is `docs/Masterplan(HSE Verify).md`, which consolidates the **HSE Verify Master Product, Feature, Workflow, UX and Engineering Specification — Phase 1 Frozen Scope — 1 August 2026** and the finalized source set. `docs/bookmarks/MILESTONE_PATH.md` records permanent order and accepted history.

## Accepted release beneath the active brick

- M1.01 — DONE — OWNER PASS.
- M1.02 — DONE — OWNER PASS.
- M1.03 — DONE — OWNER PASS.
- M1.04 — DONE — OWNER PASS.
- M1.05 — DONE — OWNER PASS.
- M1.06 — DONE — ENGINEERING PASS.
- M1.07 — DONE — OWNER PASS — 11 August 2026.
- M1.08 Company Registration and Verification — **IMPLEMENTATION MERGED — ENGINEERING PASS — OWNER ACCEPTANCE DEFERRED**.
- M1.09 Sites, Departments and Company Team — **IMPLEMENTATION MERGED — ENGINEERING PASS — OWNER ACCEPTANCE DEFERRED**.
- M1.10 Worker Invitations and Company Codes — **IMPLEMENTATION MERGED — ENGINEERING PASS — OWNER ACCEPTANCE DEFERRED TO THE COMBINED MILESTONE 1 BROWSER ACCEPTANCE AFTER M1.12**.
- M1.11 Employment, Experience, Qualification, Skill and Leaving Records — **IMPLEMENTATION MERGED — ENGINEERING PASS — OWNER ACCEPTANCE DEFERRED**.

M1.11 release evidence:
- PR `#77`;
- final exact verified head `87f28bac5cb54b06267f51f100f58668f35dc085`;
- M1.11 targeted gate `32011610521` — PASS, 27/27;
- exact-head full Engineering gate `32011610553` — PASS;
- expected-head-locked merge `ff296f7d59a6505241796f654249c3df6b97763d`;
- merged-main full Engineering gate `32012346047` — PASS, including M1.10 27/27, M1.11 27/27, strict TypeScript, lint with 0 errors, production audit with 0 vulnerabilities, optimized production build, preview smoke and release manifest.

The owner requested one combined **Milestone 1** browser acceptance after M1.12 is engineering-green. This is a test deferral, not an owner PASS. Formal Milestone 1 DONE count therefore remains **7 of 12** until that combined acceptance succeeds.

## Current build gate

# M1.12 — PUBLIC VERIFICATION FOUNDATION — IN PROGRESS

M1.12 is the **only permitted product brick** now.

Canonical branch: `build/m1-12-public-verification-foundation`.

Verified base: `ff296f7d59a6505241796f654249c3df6b97763d`.

### Canonical outcome

Create the privacy-safe public verification foundation so an unauthenticated person can check one HSE Verify public identifier without acquiring Worker, Company, evidence, assessment, reviewer, storage or mutation authority.

M1.12 owns Worker ID search, safe public projection, the QR/manual public verification route base, and **Report a Concern triage intake** derived only from the opaque public result authority. A concern may include one optional private evidence file that reuses the M1.06 validation/quarantine/malware-scan pipeline and binds only after a clean `available` result. Full credential issuance/living-record administration, scoped share links, Reviewer triage decisions and administrator credential lifecycle decisions remain later scope.

### Non-negotiable controls

1. Canonical public entry is `/verify` and accepts one supported public identifier at a time.
2. HSE Verify Worker ID is a live M1.12 lookup source. Credential/public-verification identifiers may be structurally recognized only where the accepted source exists; M1.12 must not invent later credential issuance to make a lookup appear successful.
3. QR/camera access is user-activated only. Rendering `/verify` must not request camera permission. Manual identifier entry remains available if scanning is unavailable, denied or unwanted.
4. Identifier normalization is bounded and lookup is rate-limited before expensive or identifying work.
5. Malformed, unknown, copied and unauthorized identifiers must not form an enumeration oracle. Safe misses converge on `not_found_or_invalid` where disclosure would otherwise reveal existence.
6. A successful lookup receives an opaque server-created public result capability, for example `/verify/result/[publicToken]`. Raw account, tenant, evidence, database, storage or internal record IDs are never browser authority.
7. Public projection is an explicit allow-list built from public-safe facts. Never serialize an internal Worker/credential object and then try to remove private fields.
8. Public-safe output may include only deliberately public facts such as approved Worker/credential identifier, job/trade/competency title, public verification status, issue/expiry where applicable, public restrictions and verification timestamp.
9. Public output must never expose date of birth, address, private contacts, private nationality data, evidence documents, identity documents, leaving letters, employer history, raw scores, proctoring/monitoring facts, recordings, tenant/member IDs, reviewer/verifier notes, secure-file IDs/object keys or private storage metadata.
10. Public result vocabulary is fixed: `valid`, `expired`, `suspended`, `revoked`, `not_found_or_invalid`, `temporarily_unavailable`.
11. Public verification is unauthenticated read-only projection. It never grants public mutation, review, verification-decision or storage access.
12. Rate-limit/concurrency state is server-owned and browser-unselectable. Repeated equivalent lookup activation is idempotent and must not create duplicate durable effects.
13. Public result tokens are opaque, bounded, purpose-separated and expiry-aware where applicable.
14. A public summary download, if exposed in M1.12, contains only the same allow-listed projection and is rate-limited, watermarked, time-stamped and includes the public verification URL.
15. **Report a Concern creates an immutable M1.12 triage case**, not merely a generic contact message. Intake authority comes only from the opaque public result token; browser fields cannot select Worker, concern, tenant, secure-file, storage or owner authority. Optional evidence remains private, is validated/quarantined/scanned through M1.06, and is bound only after `available`. Unsafe/scan-failed candidates are retained as rejected history and must not deadlock a later clean retry. Reviewer queue ownership and approve/reject/changes-requested decisions remain M2.02.
16. M1.05 centralized audit/outbox rules remain authoritative. M1.12 must not create a second audit mechanism.
17. M1.06 private secure storage stays private. Public verification must not expose evidence documents or use signed private-file access as a public document path.
18. M1.07 permanent Worker ID authority is reused rather than reissued or copied into a second identity system.
19. M1.11 records remain private unless a deliberately public projection requires a specific allow-listed fact; raw evidence/history stays private.
20. Any M1.12 migration must preserve accepted M1.01–M1.11 history and remain rollback/reapply safe. M1.12 retained history must not introduce hard cross-brick foreign keys that block independent rollback/reapply of older bricks.
21. Existing `/verify/worker/[workerId]` code is prototype/compatibility context only. M1.12 must prove the new public verification contract instead of assuming that route is already complete.
22. Permanent tests must cover public-field leakage, malformed/unknown non-enumeration, rate-limit concurrency, copied/expired result tokens, QR/manual fallback, private-file denial, result-state vocabulary, concern-token safety, scanned-evidence lifecycle/retry, migration/restart and lower-brick compatibility.

## Explicitly blocked while M1.12 is active

- Full credential issuance/certification decision authority.
- Living Record lifecycle administration.
- Worker-controlled scoped share links.
- Administrator suspend/reinstate/revoke/replace credential workflows.
- Reviewer evidence approval/rejection/changes-requested decisions.
- Assessment eligibility/delivery.
- Interview scoring/final assurance decisions.
- Public evidence, identity-document, recording or private-report access.
- M2.01–M2.13.
- M3.01–M3.12.
- Fake production activation of email/SMS/private-object/malware/liveness/face/document/video/payment providers.

## M1.12 TDD/build order

1. Public privacy/threat cases and field allow-list RED tests.
2. Identifier/result-capability domain plus non-enumeration RED tests.
3. Rate-limit/persistence/migration/restart/rollback invariants.
4. Dedicated public query/projection service; no authorization bypass.
5. `/verify` manual entry and opaque result route.
6. QR activation/manual fallback states.
7. Report-a-Concern triage intake plus optional M1.06-scanned private evidence; no public evidence access.
8. Concurrency/replay/privacy/lower-brick rollback regression tests.
9. Permanent `check:m1-12` and `test:m1-12` wiring into integration/quick/full gates.
10. Production build/preview proof, exact-head review, expected-head merge lock and merged-main full Engineering proof.

## M1.12 release gate

Before completing Milestone 1 engineering implementation:
1. finish M1.12 implementation and permanent regressions;
2. pass complete exact-head M1.12 targeted and full Engineering gates;
3. review privacy projection, public authority, non-enumeration, rate limits, concern/evidence intake, migration and UX on an immutable SHA;
4. merge only that exact verified head with an expected-head lock;
5. pass complete merged-main Engineering gate;
6. recheck `main` did not drift during verification;
7. then run the one combined Milestone 1 owner/browser acceptance. Owner PASS must not be inferred from CI.

## Permanent procedure

Root-cause fixes only. Never weaken an accepted test or historical constraint to fit new code. Keep one active brick. Use exact-head CI, expected-head merge locks and merged-main verification. Owner/browser PASS must always be tied to an exact release.
