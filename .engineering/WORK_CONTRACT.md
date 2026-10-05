# Verification contract EF-COMPANY-REGISTRATION-BOUNDARIES-20261005

PR12 accepted and merged at f78af3a. Continue M1.03.04 Company pending tenant and first administrator, email OTP and mandatory MFA through actual browser forms with downstream database assertions. Wrong email OTP must persist decrement and immutable failure audit while account, tenant, membership and flow remain pending. Correct email advances only to MFA; valid authenticator activates the account and owner membership, leaving tenant verification pending. Company login must create only the assigned role session. Verify exhaustion and audit failure rollback using actual repository service tests. No whole-project or live-delivery claim.

Product LOCKED until actual browser/database RED and bounded repair amendment. Prefer minimal existing transaction-outcome pattern, focused affected checks and applicable canonical CI; do not rerun unrelated complete local suites. Independent scoped acceptance required before merge.

## Bounded email repair amendment
Actual normal Company form at f78af3a reports four remaining attempts after wrong sandbox-delivered email OTP, but downstream database retains five. Pending account, pending tenant, invited owner and absence of sessions verified before failure. Artifact .autopilot/artifacts/20261005-company-email-red.txt. verifyEmail throws inside transaction after counter/audit writes, rolling them back. Return typed error/value outcome inside transaction and throw rejection after commit. Preserve valid transitions and unexpected-error atomic rollback; no schema or policy changes.

## Bounded MFA audit repair amendment
Actual browser normal valid email then six-digit invalid authenticator denial reached the service. Pending MFA flow/factor and no session verified, but immutable authentication.mfa.failed count was0 instead of1. Artifact .autopilot/artifacts/20261005-company-mfa-red-v2.txt. Same throw-inside-transaction rolls back inserted failure event. Apply the same typed committed-rejection outcome to verifyMfa only; successful enrollment/membership/flow/audit stays atomic. No MFA policy/rate-limit change.
