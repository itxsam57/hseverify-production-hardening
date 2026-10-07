# Password recovery delivery

Apply migrations through 0087, configure HSE_OTP_EMAIL_API_KEY and HSE_OTP_EMAIL_FROM for the fixed Resend adapter, and run the existing outbox worker. These are the same email settings used by registration verification. Keep secrets in deployment configuration. Configuration and queue acceptance do not certify inbox delivery.

Eligible active or locked accounts with an existing password and the selected assigned role receive an encrypted recovery intent. The challenge, recovery flow, intent, opaque dispatch job and required security audit commit together. Requests and resend feedback do not reveal whether an account or role exists. Without Sandbox or configured email, the form is disabled with a general unavailable message; request/resend Server Actions enforce that state against client bypass. Resend preserves the cooldown and replaces the previous challenge when eligible.

The existing authentication challenge dispatcher handles the fixed recovery-verification origin. It checks the referenced live flow, account, role, challenge and lease after locks using the database clock. Decrypted destination, code and password_reset purpose must match the persisted challenge. Email requests run outside database transactions and retries reuse the challenge idempotency key. Accepted means provider acceptance. Terminal or obsolete intents clear ciphertext.

A successful reset consumes the flow/challenge, updates the password and revokes existing sessions atomically. It does not log the user in or remove staff MFA. Wrong codes commit their bounded attempt count; expired, consumed or exhausted flows fail without changing the password. Sandbox code viewing remains available only in authorized Sandbox configuration.

Storage intentionally reuses auth_registration_delivery_intents; the legacy physical name does not narrow its finite authentication-delivery state machine. Migration 0087 extends the fixed outbox origin vocabulary additively. Its rollback preserves historical intent/job references, as does 0086. Do not destroy authentication history to roll back application code.

Permanent native tests exercise the actual six-role producer, registered dispatcher, reset, audit rollback, stale challenge suppression, retry, malformed encrypted payload cleanup and post-lock expiry checks. Permanent browser tests exercise the six-role forms, old-password denial, session revocation and retained MFA using a local fixed-endpoint transport double. Live inbox delivery and real PostgreSQL held-lock contention remain separate release checks.
