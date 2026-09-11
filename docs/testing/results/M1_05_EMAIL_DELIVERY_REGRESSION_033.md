# REG-033 — Email platform fixtures must preserve accepted lower-layer invariants

## Status

**PROTECTED — 9 August 2026**

## Defect

The M1.05 Subunit 4 platform integration suite attempted to reach email-delivery assertions by constructing lower-layer rows that were invalid under already-accepted database contracts. Three fixtures generated 64-character strings from arbitrary letters such as `p`, `h` and `j`, which violated SHA-256/hex constraints before the intended email assertion ran. The stale-lease fixture also changed an outbox attempt to `lease_expired` without the required error code and summary, violating the accepted outbox attempt lifecycle shape.

## Root cause

The test helper imitated cryptographic and lifecycle fields instead of using representations that satisfy the already-accepted lower-layer invariants. This made the new email tests fail for the wrong reason and obscured the behavior they were meant to verify.

## Permanent correction

`tests/platform/email-delivery-foundation.test.mjs` now:

- derives deterministic 64-character fixture values with real SHA-256;
- transitions synthetic outbox attempts to `lease_expired` with the required `error_code`, `error_summary` and `finished_at` fields;
- keeps the existing lower-layer constraints enabled rather than bypassing or weakening them;
- continues to exercise email queue, exact-lease completion, stale/reclaimed lease behavior, recipient/Company tenant isolation and unverified-recipient rejection.

## Expected behavior

A higher-layer integration test must reach its intended assertion through state that is valid under every already-accepted lower layer. Tests must not weaken schema constraints, invent impossible lifecycle rows or use malformed cryptographic placeholders simply to make setup easier.

## Automated guard

- `tests/platform/email-delivery-foundation.test.mjs`
- complete `test:email-delivery-platform` gate
- complete application `npm run check` gate

No owner/browser test is required for this regression itself.
