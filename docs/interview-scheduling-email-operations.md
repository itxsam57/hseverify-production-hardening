# Interview scheduling email

Scheduling records independent in-app and email intents for the current Worker, assigned Assessor and authorized Company recipients. Each email binds to the immutable schedule event, membership and verified address fingerprint. An enqueue failure preserves the schedule and retries through the existing worker, oldest first, at most 50 events per pass with a 30-second deferral cadence.

Configure HSE_PUBLIC_BASE_URL to the application's HTTPS origin and set the existing HSE_OTP_EMAIL_API_KEY and HSE_OTP_EMAIL_FROM provider settings. The sender domain must be verified with Resend. Development/test permit local HTTP origins. Missing configuration results in retrying work and eventually a visible terminal failure; it never produces a successful send.

Run the normal compiled outbox worker. The fixed message contains a sign-in link to the authenticated current record, without a capability token or schedule details. Changed addresses, access loss, cancelled or superseded schedules and notices beyond the existing four-hour recovery window are suppressed before dispatch. Transport timeout is ten seconds. Retries use the same job key and generic message. Provider acceptance records Sent with no Delivered timestamp. Delivery webhooks and live provider certification remain separate unfinished work.

Resend retains idempotency keys for 24 hours and rejects a changed request payload for the same key. Avoid changing sender/origin during an ambiguous retry. The worker stops new provider calls 23 hours after the oldest persisted Resend attempt, even when the schedule is far in the future. It retains terminal failure code idempotency_window_expired with confirmation unknown; reconcile provider records before any manual resend. An unconfigured early attempt conservatively consumes this window. Provider idempotency is bounded; no permanent exactly-once claim is made. Source: https://resend.com/changelog/idempotency-keys

Rollback is refused while scheduling email history remains. Empty rollback restores the exact previous constraints and attempt functions. Roll back migration 0089 before rolling back its scheduling source dependency 0088.

Verification uses real native SQL/services and the compiled CLI with controlled transport. It does not certify live email delivery or PostgreSQL multi-connection contention.
