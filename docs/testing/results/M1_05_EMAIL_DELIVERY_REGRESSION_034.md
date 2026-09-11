# REG-034 — Shared outbox handler arguments must not collide with feature dependency injection

## Status

**PROTECTED — AUTOMATED PASS — 9 August 2026**

## Defect

The complete application TypeScript gate rejected the M1.05 Subunit 4 outbox handler registry after the shared worker contract was extended to pass a trusted outbox lease as the second handler argument. The existing notification projector already uses its second argument for optional test/runtime dependency injection (`database` and `repository`). Assigning that projector directly into the shared `(job, lease)` registry therefore made the trusted lease structurally collide with an unrelated dependency-injection slot.

## Root cause

Feature handlers were assigned directly into one shared registry even though their public call signatures have different meanings beyond the job argument. The central worker correctly needs one standardized `(job, trustedLease)` execution contract, but feature-specific functions must adapt to that contract explicitly rather than relying on accidental structural compatibility.

## Permanent correction

- The central outbox worker retains one strict `(job, trustedLease)` execution contract.
- The notification registry entry is an explicit job-only adapter and calls `projectNotificationOutboxJob(job)` without passing the lease into notification dependency injection.
- The email registry entry is an explicit `(job, lease)` adapter and calls `processEmailDeliveryOutboxJob(job, lease)`.
- No `any`, unsafe cast or weakened TypeScript setting was introduced.
- Notification and email feature dependency contracts remain independent.

## Permanent guards

- `tests/outbox/outbox-worker-handler-contract.test.mjs` proves notification and email are adapted separately and that notification never receives `lease` as dependency input.
- `scripts/check-notification-foundation.mjs` requires the safe notification wrapper and forbids job+lease notification projection.
- `scripts/check-email-delivery-foundation.mjs` requires explicit email lease forwarding and forbids the old direct handler assignment.
- Full-project `typecheck`, notification regressions, real email-delivery runtime regressions and production build remain in the complete application gate.

## Validation evidence

The repaired implementation head passed the complete engineering gate on 9 August 2026:

- PR branch head: `831702670a4b2c3f23fad3c9eca0301148b3e0f1`
- Engineering run: `31316549538`
- Validation job: `93252630064`
- Complete application gate: **PASS**
- Deployable preview smoke: **PASS**
- Release evidence manifest: **PASS**
- Full-project strict TypeScript: **PASS**
- ESLint: **PASS**
- Development/runtime database smoke: **PASS**
- Production build: **PASS**

REG-034 is now permanently regression-protected. Subunit 4 still requires final documentation-head validation, merge, merged-main validation and owner acceptance before it can be marked DONE.
