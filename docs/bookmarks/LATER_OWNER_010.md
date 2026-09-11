# LATER-OWNER-010 — Worker OTP submission and registration density

Status: RESOLVED — OWNER ACCEPTED

Reported: 3 August 2026

Resolved: 4 August 2026

Area: M1.03 Worker registration and mandatory dual OTP owner test.

## Owner-observed defects

1. Retrieved OTP codes did not advance registration.
2. Registration fields were visually misaligned.
3. Phone/password guidance was too dense for a basic registration step.
4. Intermediate repairs produced a generic verification failure and later exposed an HTTP 500.

## Final confirmed root cause

The email-to-phone registration-flow update assigned an ISO timestamp parameter through a SQL CASE expression into `completed_at TIMESTAMPTZ`. PostgreSQL/PGlite inferred the parameter as text and rejected the transition with error 42804.

## Final repair

- preserved the accepted one-column registration layout;
- retained challenge-bound same-origin OTP POST routes;
- explicitly cast the completion timestamp and null CASE branch to `timestamptz`;
- explicitly cast the flow `updated_at` value;
- added `tests/platform/worker-registration-flow-sql.test.mjs` covering both email-to-phone and phone-to-complete transitions;
- included the regression in the complete repository gate.

## Owner acceptance

The owner completed a fresh registration and confirmed that both the email OTP and phone OTP were accepted and the account reached activation completion.

## Closure boundary

This defect is resolved. The result is recorded in:

- `docs/testing/results/M1_03_OWNER_WORKER_DUAL_OTP_PASS.md`

M1.03 remains under owner hard testing for its other authentication, session, recovery, MFA, invitation and portal-isolation sections. M1.04 remains blocked until the complete M1.03 owner hard test passes.
