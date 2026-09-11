# LATER-OWNER-011 — Worker failed-password lockout did not persist

Status: RESOLVED — OWNER ACCEPTED

Reported: 4 August 2026

Resolved and owner accepted: 4 August 2026

Area: M1.03 Section F — Worker lockout and password recovery.

## Owner-observed failure

The owner entered an incorrect Worker password five times. On the sixth attempt, the correct password was accepted and the Worker signed in instead of receiving the temporary-lock message.

## Reproduced root cause

The lockout repository update assigned an ISO timestamp parameter through a SQL `CASE` expression into `auth_accounts.locked_until`, which is a `TIMESTAMPTZ` column. PostgreSQL/PGlite rejected the statement with error `42804` because the expression resolved as text. Each failed-password transaction therefore rolled back, leaving `failed_sign_in_count` unchanged and the account active.

The same audit found an equivalent untyped timestamp `CASE` in OTP terminal-attempt invalidation for `auth_otp_challenges.invalidated_at`.

## Implemented repair

- cast the lock timestamp branch to `timestamptz`;
- type the lockout null branch as `NULL::timestamptz`;
- cast the failed-attempt `updated_at` value to `timestamptz`;
- cast the OTP terminal invalidation timestamp to `timestamptz`;
- add `tests/platform/authentication-failure-state-sql.test.mjs`;
- execute attempts 1 through 5 against migrated PGlite;
- assert attempts 1–4 stay active with no lock timestamp;
- assert attempt 5 persists `account_status = 'locked'`, count 5 and the lock expiry;
- assert a sixth active-account failure update affects zero rows;
- assert clearing lockout resets count, status and timestamp;
- assert OTP failure attempts persist and the final attempt writes `invalidated_at`;
- include the new regression in `test:auth-completion` and the full `npm run check` gate.

## Owner-confirmed acceptance

The owner pulled merge commit `403056b85f52b7e2c656b0585b6ced50fdad140a` and confirmed:

- five incorrect Worker passwords persisted the lock;
- the correct password was rejected while the account was locked;
- password recovery cleared the lock;
- the reset recovery code/flow could not be reused and required starting a new session;
- every pre-reset Worker session was revoked, forcing a fresh sign-in;
- the new password signed in successfully;
- the old password was rejected.

A temporary sandbox-access denial during the retest was caused by an incorrect key supplied in the test instruction, not by the application. Local sandbox tests must use the exact current `HSE_AUTH_SANDBOX_ACCESS_KEY` from `.env.local`.

## Closure boundary

M1.03 Section F is owner PASS. This defect is closed. M1.04 remains blocked until every remaining M1.03 owner-test section passes.
