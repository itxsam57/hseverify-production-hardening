# M1.07 Subunit 4 Acceptance

## Scope

M1.07 Subunit 4 — **Automated Identity Checks and Provider Adapter Boundary**.

This acceptance closes only S4. M1.07 remains IN PROGRESS. S5 is next; S6 remains blocked by S5 and is the first new browser-visible owner-test boundary. M1.08 remains blocked until the complete M1.07 brick is accepted.

## Accepted implementation evidence

- implementation PR: `#63`;
- exact final implementation head: `f606caec4844fe1886e4a2365905f353b1c0d896`;
- exact-head full engineering gate: `31409916231` — **PASS**;
- implementation merge: `4d0172ab9bc11c0253b26401f20ba087e1785b81`;
- merged-main full engineering gate: `31410396183` — **PASS**;
- browser/owner test: **NOT REQUIRED — no browser-visible product surface changed**.

## Accepted behavior

1. The accepted M1.05 durable outbox remains the only background-work authority. S4 adds the explicit fixed job type `worker_identity.automated_checks`; it does not create a second queue and does not disguise identity work as another job type.
2. A Worker can schedule automated checks only for the Worker's own exact current submitted identity version. Worker/browser authority cannot select a provider, reviewer, tenant or lifecycle decision.
3. Only an exact live trusted outbox lease can begin an automated-check run and move the accepted submitted identity to `automated_checks`.
4. Check runs and results are durable, idempotent/retry-safe, exact-version-bound and restart-safe.
5. The fixed check vocabulary is `document_consistency`, `face_comparison` and `liveness`; accepted outcomes are bounded to `passed` or `needs_review`.
6. The deterministic development/test adapter exercises the same typed provider boundary while explicitly remaining non-production. It does not claim real document authenticity, biometric identity or liveness verification and cannot verify, reject or merge an identity.
7. Development/test completion can move only `automated_checks -> manual_review`; provider output is assistive evidence rather than final identity authority.
8. Preview/production provider-dependent checks fail closed while no approved provider is configured. The run records `provider_unavailable`, the outbox job terminal-fails, and the identity is not fabricated into a later decision state.
9. Stale/withdrawn jobs drain safely without advancing an obsolete or non-current identity version.
10. Outbox payloads, audit facts and persisted provider summaries remain bounded and contain only opaque references/fixed codes; they do not persist raw identity images, document numbers, contact values, object keys, hashes, credentials or tokens.
11. Historical migration `0013_secure_file_malware_scan` was widened only to preserve the immutable accepted outbox vocabulary during replay. Its new canonical checksum is pinned to `89a0168ff92b2d0df5dad4d5f1b9b99ab5d5a2c92c1b28ce7e03fdf9a16baada`, with only the exact accepted predecessor checksums permitted.
12. REG-076 cross-platform CRLF/LF migration canonicalization remains preserved while the S4 historical checksum lineage is extended.
13. S4 introduces no M2.02 reviewer queue, no `/worker/identity` route and no browser-visible identity workflow.

## Cumulative regression evidence

The exact-head and merged-main gates both reran the accepted M1.01-M1.06 suites and M1.07 S1-S3 suites. The S4 runtime suite covered deterministic local/test behavior, fail-closed preview/production behavior, batch validation, restart persistence, historical migration replay, scheduling/idempotency/system lease authority, provider-unavailable terminal behavior, stale/withdrawn job drainage and Worker-only/revoked-session denial.

No independent new product/security defect remained after the final exact-head pass. Pre-acceptance source-check wording and the incorrect `AppEnvironment` type name were resolved before acceptance and did not require a new stable regression identifier.

## Closure decision

**S4: ACCEPTED FOR CLOSURE.**

After this closure branch passes its own exact-head full engineering gate and merged-main verification:

- S4 becomes **DONE**;
- S5 — Duplicate Signals, Recovery and Worker-ID Eligibility becomes **READY TO BUILD**;
- S6 remains blocked by S5;
- no browser test is required before starting S5.
