# Admin interview email manual retry

Requirement: Masterplan section 28 manual retry, scoped to scheduling email. Admin requests make at most 50 eligible delayed jobs available to the existing worker without changing job identity, payload, provider key or retry limits.

Observed tests use the actual scheduling producer, native PGlite SQL, authenticated Admin form and compiled worker with controlled Resend transport. Four runtime cases cover repeated requests, configuration denial, foreign/revoked/disabled/expired authorization, required-audit rollback, expiry during audit, and exclusion of old ambiguous provider history, active leases, pending and terminal jobs. The browser checks disabled unconfigured state, the real server action, persisted original job identity and three Admin audit entries, subsequent accepted sends, foreign Worker denial and a 390px layout.

An initial expiry fixture violated the session chronology constraint and was corrected; that failure is not product authorization evidence. A separate live-clock test then reproduced session expiry during audit committing incorrectly. A final fresh authorization check now makes that transaction roll back.

Repeat: npm run test:interview-email-manual-retry and npm run test:interview-email-manual-retry-browser; both are included in normal regression commands. These observations do not certify live Resend delivery, PostgreSQL multi-connection locking, production scale, deployment, reconciliation, webhooks or the complete Masterplan.
