# M1.06 Final Acceptance Evidence

Status: ACCEPTED FOR FORMAL CLOSURE

## Accepted implementation

- M1.06 Subunits 1–4: previously accepted and closed.
- M1.06 Subunit 5 exact implementation head: `86d135f87a2a2b53f12b8d5b1a2438944cd426fc`.
- Exact-head full engineering gate: GitHub Actions run `31362444454` — SUCCESS.
- Exact-head PR #55 merged with expected-head SHA lock.
- Resulting `main` merge commit: `4ee689e244c938d04a7db3d58306cff8e20b6213`.
- Merged-main full engineering gate: GitHub Actions run `31362848897` — SUCCESS.

## Cumulative acceptance proved

The final M1.06 gate composes the accepted secure-file implementation on shared real local/test persistence and proves:

- Worker reservation/replay, validated quarantine/replay, durable scan/replay, real outbox handling, available state and signed access.
- Revoked session denial before private-storage read.
- Malicious evidence becomes unsafe and cannot enter signed access.
- Post-scan private-object tampering is denied by final byte-size/SHA validation without mutating accepted provenance.
- Company secure files remain bound to the exact tenant and membership; cross-tenant and stale-membership use are denied.
- PGlite and private-object close/reopen retain accepted file, scan-job, object and audit/access state.
- Complete M1.06 rollback/reapply retains immutable historical facts and deterministic migration state.
- Explicit historical migration checksum repairs accept only the pinned legacy/current pairs for repaired M1.06 migrations and fail closed for unknown/tampered checksums.

## Stable regressions added during Subunit 5

- REG-070 — PR exact-head CI identity.
- REG-071 — runtime `@/lib/*` dependency resolution in the isolated cumulative test harness.
- REG-072 — historical M1.06 migration replay must not narrow the append-only immutable audit vocabulary.

Detailed guards remain in `docs/engineering/M1_06_SUBUNIT5_REGRESSIONS.md`.

## Manual/browser requirement

Subunit 5 and the final M1.06 closure add no browser-visible product surface. A browser owner test is therefore not manufactured for this internal acceptance unit. The next genuine visible live-test work belongs to M1.07 Worker Onboarding / Identity Engine.

## Closure condition

This evidence permits the separate governance/context transition that marks M1.06 DONE. M1.07 must remain blocked until that closure transition itself passes exact-head and merged-main full engineering gates.
