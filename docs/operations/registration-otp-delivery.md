# Registration verification delivery

Worker onboarding requires configured email and SMS providers. Company onboarding requires email.
Supply HSE_OTP_EMAIL_API_KEY and HSE_OTP_EMAIL_FROM (a verified sender email address) for Resend.
Supply HSE_OTP_SMS_ACCOUNT_SID, HSE_OTP_SMS_AUTH_TOKEN and HSE_OTP_SMS_FROM (international sender number) for Twilio.
Keep secrets in deployment environment configuration; never commit or log them.

Apply database migrations through 0086 and run the existing outbox worker. The Admin operations page shows registration channel configuration separately from other email features. Configuration does not certify live delivery.

Issuance commits the challenge, encrypted delivery intent, opaque outbox job and required audit together.
The registered dispatcher checks live challenge, flow and lease state using the database clock after acquiring locks.
Provider requests run outside transactions. Queue completion means provider acceptance, never inbox/device delivery.
Email retries reuse the challenge idempotency key. Ambiguous SMS dispatch becomes unknown; the worker never automatically sends that intent again.
Terminal retry exhaustion and expired final leases clear encrypted payloads in the same audited transaction.
Account abandonment clears pending payloads while preserving provider/job history.

For an unknown outcome, check provider records before initiating another message. The user can request a new code after the existing resend cooldown; this creates a new challenge and invalidates the old one. Do not replay an unknown SMS job.
Migration rollback is monotonic and preserves historical data and vocabulary. Reapply is tested; rolling back application code stops new registration dispatch.

Local evidence uses actual databases, registered outbox handlers and browser forms with fixed-endpoint fetch doubles.
Live Resend inbox acceptance, live Twilio device delivery and PostgreSQL held-lock contention are separate release checks and are not claimed by these fixtures.
