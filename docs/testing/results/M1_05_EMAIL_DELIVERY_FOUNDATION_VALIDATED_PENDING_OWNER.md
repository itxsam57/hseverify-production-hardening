# M1.05 Subunit 4 — Automated Validation Pending Owner

## Status

**AUTOMATED PASS — FINAL PR DOCUMENTATION HEAD VALIDATION PENDING — OWNER PASS PENDING**

Date: 9 August 2026

## Validated implementation candidate

- Pull request: `#43`
- Branch: `build/m1-05-email-delivery-foundation`
- Validated implementation head: `831702670a4b2c3f23fad3c9eca0301148b3e0f1`
- Engineering run: `31316549538`
- Validation job: `93252630064`
- Complete application gate: **PASS**
- Deployable preview smoke: **PASS**
- Release evidence manifest: **PASS**

## Focused proof passed

The successful gate includes:

- durable email source contract checks;
- email domain unit tests;
- PGlite queue/attempt/lease/isolation tests;
- `0010_email_delivery_foundation` rollback/reapply and restart persistence;
- real outbox repository + email repository + handler + local/test adapter execution;
- successful delivery;
- retry once then success;
- fifth-attempt terminal failure;
- reclaimed delivered job without redispatch;
- plaintext-recipient persistence denial;
- notification/outbox adapter separation under REG-034;
- all accepted authentication, authorization, tenant, audit, outbox and notification regressions;
- Worker registration migration proof beneath later layers;
- strict full-project TypeScript;
- ESLint;
- development smoke;
- protected portal redirects;
- runtime database smoke;
- deterministic production build.

## Defects discovered and permanently guarded

- REG-027 — migration regressions coupled to the repository-wide latest migration.
- REG-028 — stale/reclaimed email lease start/finalize risk.
- REG-029 — duplicate attempt-start audit on re-entry.
- REG-030 — redispatch after durable delivered/terminal state.
- REG-031 — runtime test compiler semantics diverged from the application.
- REG-032 — PostgreSQL INTEGER/SMALLINT parameter inference conflict.
- REG-033 — higher-layer fixtures violated accepted lower-layer invariants.
- REG-034 — shared outbox lease collided with notification dependency injection.

## Scope exclusions preserved

No live SMTP/API provider, provider credential, browser email queue, business-domain email template/type, SMS delivery, Subunit 5 combined acceptance or M1.06+ work was introduced.

## Remaining gate before owner handoff

The implementation code is validated, but this record and the owner hard-test documentation changed the PR head after the successful implementation run. Therefore the exact final documentation head must pass the complete engineering gate again before PR #43 can be marked ready and merged.

After merge, merged `main` must independently pass. Only then may the owner run `docs/testing/M1_05_EMAIL_DELIVERY_FOUNDATION_HARD_TEST.md`.

Subunit 4 is **NOT DONE** until owner PASS is recorded and its final acceptance closure is merged.
