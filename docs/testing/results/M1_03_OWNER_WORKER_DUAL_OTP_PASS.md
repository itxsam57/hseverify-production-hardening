# M1.03 Owner Hard Test — Worker Dual OTP Registration PASS

Status: PASS

Owner acceptance date: 4 August 2026

Scope: M1.03 section D — public Worker registration with mandatory email and phone OTP.

## Owner-confirmed result

The owner completed a fresh Worker registration using the development authentication sandbox and confirmed that:

- the registration form remained in the accepted one-column layout;
- the email OTP was accepted;
- the workflow advanced from email verification to phone verification;
- the phone OTP was accepted;
- the workflow reached account activation completion;
- the registration flow no longer returned the prior generic failure or HTTP 500.

## Confirmed root cause and permanent regression

The final failure was a PostgreSQL/PGlite type error in the registration-flow transition. The `completed_at` CASE expression treated the supplied ISO timestamp as text rather than `TIMESTAMPTZ`. PR #21 corrected the SQL casts and added `tests/platform/worker-registration-flow-sql.test.mjs`, which executes both:

- `pending_email` to `pending_phone`, preserving `completed_at = NULL`;
- `pending_phone` to `complete`, writing the completion timestamp.

## Gate effect

- `LATER-OWNER-010` may be closed.
- M1.03 is not yet fully owner-accepted because the remaining M1.03 hard-test sections must still pass.
- M1.04 remains blocked until the complete M1.03 owner hard test is accepted.
