# M3.12.02 — Operational database probe, alert and incident response

**Release classification: NOT FULLY VERIFIED / NO-GO.** This is a scoped, manually installed monitor. It does **not** automatically schedule checks, contact a real on-call person, validate external providers, certify migrations, or authorize production.

## What is actually implemented

- Authenticated `GET /api/operations/readiness` returns `200 {"status":"ready","scope":"database_connection_only","releaseSha":"<SHA>"}` only when a real SQL `SELECT 1` succeeds. Wrong/missing bearer returns `401`; missing token or database failure returns `503`. Responses are noncacheable and contain no personal data.
- `npm run ops:check-readiness` makes a real, nonredirecting HTTP GET to that endpoint, checks the **exact 40-character deployed SHA** and expected scope, then sends an HTTP alert to the **configured receiving webhook** on outage, incorrect SHA or unavailable database. An accepted webhook response records `incident_open`. A later healthy check sends `incident_recovered`.
- On-disk incident state uses a lock, atomic restricted-permission writes and a stable idempotency key. Repeated outages do not flood the receiver. Rejected/uncertain HTTP delivery is retried with the same key. An unacknowledged opening is still closed on recovery (it may have reached the receiver), and a renewed outage after an unacknowledged recovery uses a new incident ID so it cannot be suppressed. Malformed state, missing credentials or non-HTTPS external URLs fail closed. It sends only generic availability fields and never includes credentials.
- Exit codes: **0 healthy** (or recovery accepted); **2 outage** (open alert accepted or already open); **3 configuration, bad state or unconfirmed receiver**; **4 concurrent monitor run already in progress**.

## Deployment requirements — currently BLOCKED_EXTERNAL

The application runtime must set `HSE_MONITOR_PROBE_TOKEN` to a secret of at least 32 characters and `HSE_RELEASE_SHA` to the actual 40-character deployed commit. The independent monitoring process requires the following **private environment variables**:

| Variable | Purpose |
| --- | --- |
| `HSE_MONITOR_PROBE_URL` | Exact HTTPS URL ending in `/api/operations/readiness` |
| `HSE_MONITOR_PROBE_TOKEN` | Same private token as the application |
| `HSE_MONITOR_EXPECTED_SHA` | Approved, immutable 40-character stage/release SHA |
| `HSE_MONITOR_WEBHOOK_URL` | HTTPS endpoint for the approved support/paging receiver |
| `HSE_MONITOR_WEBHOOK_TOKEN` | Bearer token expected by that receiver (min 32 characters) |
| `HSE_MONITOR_STATE_FILE` | Private absolute on-disk path in a persistent, writable monitoring directory |

Run `npm run ops:check-readiness` on a **separate operator-managed monitor** with a scheduler that prevents overlapping executions. Pin credentials in its secrets manager, never in repository, CLI arguments, source logs or chat. The monitor must retain its state file across restarts. HTTPS credentials/certificate verification are mandatory; `HSE_MONITOR_ALLOW_LOOPBACK_HTTP=true` is exclusively for isolated localhost tests. A lock left after a monitor crash requires a verified single-instance recovery; never blindly delete a live lock.

Provision and separately verify the actual webhook receiver, paging destination, routing/rotation, escalation, acknowledgements, retries, production alert thresholds and owner access. **Only an HTTP 2xx webhook response is evidenced by this code; actual pager/human delivery is NOT verified.** Receiver idempotency enforcement is required for at-least-once HTTP delivery.

## Support and incident sequence

1. Any exit 2/3/4 requires an operator to inspect the recorded alert and verify the expected SHA, database availability and impacted accounts/cases without exposing personal records. Treat a missing/failed receiver as an operational incident, not a false green.
2. Declare the incident and notify the designated on-call owner through the *independently configured* provider. Keep production deployment frozen until verified.
3. Record UTC incident time, monitor state/event ID, exact deployment SHA, affected infrastructure and escalation evidence. Do not infer recovery merely from a healthy browser login page.
4. For database/data corruption, use `docs/operations/postgres-backup-restore.md`: preserve the original database and separately backed-up private object files; restore a **new isolated** PostgreSQL database, check hashes/owner access and migration state before anything is exposed. Do not roll back schema or delete active consumer records in place.
5. For a code rollback, the existing GitHub **Build rollback candidate** workflow takes an approved `target_ref`, runs checks/smoke and publishes an artifact. **It does not deploy or promote anything.** Manual deployment approval, configuration/security checks, compatibility review, exact artifact SHA reconciliation and Owner signoff remain mandatory.
6. After restoration, require authenticated real Worker/Reviewer/Company/Assessor/Admin/Root flows, retained audit and files, and explicit on-call acknowledgement. The monitor's `incident_recovered` HTTP acceptance alone is not sufficient signoff.

## Verified local scope and outstanding gates

The isolated QA branch is based on `3673fc42b54df50a2bd145743b04f8b63a1a445d`. Commands:

```bash
npm run test:m3-12-ops-monitor
npm run typecheck
npm run lint
```

Synthetic loopback receiver + real HTTP probe outage/recovery, idempotent delivery retries and fail-closed configuration, and real Next/PGlite success plus unavailable PostgreSQL and bearer failures are exercised. CI runs the same tests with an exact SHA checkout. Store source SHA, exit codes and log paths under the worktree's `.autopilot/artifacts/` and governance audit.

**Still missing:** provider-grade external receiver delivery/acknowledgement, scheduled deployment/monitoring, production monitoring thresholds, on-call response and escalation, protected final exact-SHA staging, live provider integrations, real fault/recovery drill and RPO/RTO, comprehensive 218-scenario verification, independent full pentest and Owner UAT. Leave M3.12.02/M3.12.03/M3.12.04 **NOT_FULLY_VERIFIED**, and release **NO-GO**.
