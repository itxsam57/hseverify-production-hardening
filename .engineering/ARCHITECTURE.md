# Boundaries to preserve
Next.js App Router and server actions use trusted authenticated role/account/tenant scope. PostgreSQL/PGlite repositories own transactional persistence. Permanent identity, question exposure, immutable consent/review history, audit and outbox must survive corrections and reassessment.
CI invokes repository-owned package scripts. Synthetic local/private CI browser evidence remains distinct from live providers, production deployment, runtime heartbeat and owner verification.
Existing .autopilot guard/session/state remains the enforcing mechanism. Factory state records evidence and next action; it does not bypass or replace guards.
