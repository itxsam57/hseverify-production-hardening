# Security invariants
No hook/CI bypass, fabricated evidence, secret logging, unrelated destructive changes, consent-history erasure, or cross-worker/cross-tenant access.
Tests use synthetic isolated databases and sandbox accounts/media/payment. Never use fixture secrets or identities as production credentials.
Workflow permissions remain contents:read. Evidence includes SHA, commands, statuses and artifact references, not private customer content or raw credentials.
Withdrawal reconciliation cannot reactivate revoked access.
