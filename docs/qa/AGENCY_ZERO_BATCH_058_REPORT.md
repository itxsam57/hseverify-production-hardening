# ZERO-058 — Launch and operations technical evidence

**4 of at most five original related workflow units attempted.** Selected source case results after one setup-only source retest: **4 PASS**, **0 FAIL/UNPROVEN after documented retry**. **0 newly TECH FULLY VERIFIED.**

Source application SHA: `7ff30ea140a5145e5d5ba761f7c7aef24c895269`. QA tooling SHA at run: `2aee5e162c7cc0d9f14858f41043085d302f2cb1`. Original app/prod/staging were not modified. Local synthetic fixtures; real browser cases where indicated.

| Original scenario | Selected source test | Outcome |
|---|---|---|
| `M3.12.01` | otherwise valid production configuration is accepted by both application and scripts | SCOPED PASS |
| `M3.12.02` | M3.12 real Chromium Admin handover preserves audit, stale denial and NO-GO release authorization | SCOPED PASS |
| `M3.12.03` | production never describes disabled fixtures as available | SCOPED PASS |
| `M3.12.04` | M3.12 cold PG16 custom archive and private object restore preserves active Worker case, draft, identity, and signed bytes — approved isolated retest | SCOPED PASS (revalidated) |

## Three discipline reviews — not independent certification

**ENGINEER:** Selected checks performed in the actual source application and/or isolated DB, with real input/role assertions where present. The initial failed setup was corrected and exact original source test reran 1/1 PASS. Initial failure remains SHA256-attested. Full intended scenario is not verified. Complete route inventory, cross-role connected effects, maintainability and responsive UI are not fully audited.

**CYBERSECURITY:** Selected negative, permission, file or race assertions were exercised only to the extent verified in each case source. No entire attack-surface, penetration-scope, independent replay, security race, provider contract or load assurance is implied. High/critical vulnerability count for full app: **UNKNOWN**.

**REVIEWER:** Original ID, title, selected test log and result accounted for, but full original Masterplan workflow/visual/code independent signoff has **not** been completed. No claim of accredited third-party review.

## Outstanding per-case test scope

- `M3.12.01`: No direct older source-case link; discovered related case must be mapped/reviewed. Remaining complete role/UI/security/adapter-contract/reviewer evidence to be gathered.
- `M3.12.02`: No direct older source-case link; discovered related case must be mapped/reviewed. Remaining complete role/UI/security/adapter-contract/reviewer evidence to be gathered.
- `M3.12.03`: No direct older source-case link; discovered related case must be mapped/reviewed. Remaining complete role/UI/security/adapter-contract/reviewer evidence to be gathered.
- `M3.12.04`: Initial disposable Postgres Unix socket path length error corrected; source case PASS on isolated PG16 retest and cluster stopped. Full protected-stage backup/recovery, incident runbooks, active users and operational restoration still open. Initial and corrected logs preserved.

## Raw test evidence (workstation-private; SHA256)

- `M3.12.01`: `private-workstation:artifacts/agency-zero/ZERO-058/M3.12.01.log` — SHA256 `919c31f749519518b54e2505330617930d9e55d666973459e18bd0201cd26748`, selected run exit 0, TAP {'tests': 1, 'pass': 1, 'fail': 0, 'skipped': 0}.
- `M3.12.02`: `private-workstation:artifacts/agency-zero/ZERO-058/M3.12.02.log` — SHA256 `c30e7622edf51159eaf9aa2482bed3e06ae1b23e5d962210b175d266a1a9512b`, selected run exit 0, TAP {'tests': 1, 'pass': 1, 'fail': 0, 'skipped': 0}.
- `M3.12.03`: `private-workstation:artifacts/agency-zero/ZERO-058/M3.12.03.log` — SHA256 `73e2f4e152437cf1885f1ef3fa2eff0eac99a849c44439280b8edae3a7982f13`, selected run exit 0, TAP {'tests': 1, 'pass': 1, 'fail': 0, 'skipped': 0}.
- `M3.12.04`: `private-workstation:artifacts/agency-zero/ZERO-058/M3.12.04.log` — SHA256 `c1c0e94a44712f84194ba3d29d74703ee16b648d80a989229ee5b2f61588c1ef`, selected run exit 125, TAP {'tests': None, 'pass': None, 'fail': None, 'skipped': None}.

## Exact continuation

This batch is recorded as attempted/incomplete, **not confirmed**. Save raw evidence; do not repeat passed scoped tests without a changed candidate or reason. Continue next separate related batch while the unfinished security and independent reviews stay in the original unresolved queue.

Recorded UTC: 2026-11-23T02:36:33.042870+00:00

## Correction of initial QA-only test-environment blocker, preserved initial failure

The selected actual PostgreSQL16 cold restore originally did NOT execute because our new private database could not start: its Unix socket path exceeded the OS 107-byte limit. The original failed initdb/pg_ctl logs remain. We reused **only this newly initialized disposable cluster**, moved its socket under a short private `/tmp` directory, and reran the exact selected real PG16 source case: **PASS 1/1**. The source test created uniquely named test DBs, migrated, committed Worker answer/draft and signed evidence, cold `pg_dump`/`pg_restore` and private-object restore, checked Worker/foreign access and hashes, then dropped test DBs. The isolated loopback server was confirmed shut down (`pg_ctl stop` exit 0) and no shared PG/staging/prod service was used. This is NOT a protected final staging recovery drill.

- Original selected case `M3.12.04` revalidation source: `M3.12 cold PG16 custom archive and private object restore preserves active Worker case, draft, identity, and signed bytes`; retest SHA256 `67d18094bd3112e9186913861da6d1fbceab2b9ea1eba9da050f4cf339060169`.

**TECH FULL=0**; all external/provider/physical production and independent expert gates remain open. The initial `results.tsv` records the first attempt and is retained; cursor/evidence register contain the documented newer, scoped result.

## Original required scopes still NOT fully verified (per discipline)

- `M3.12.01`: The source environment accepted valid production configuration in the selected test. Actual pinned candidate clean install/build, real PG16 startup/migrations/health, protected HTTPS reverse-proxy and runbook deploy were not verified together.
- `M3.12.02`: Real Admin browser handover saved audit, rejected stale changes and truthfully displayed NO-GO. Genuine pager/alert escalation, support operations, rollback rehearsal, owner UAT and executable on-call recovery remain unverified.
- `M3.12.03`: Production provider-health service did not falsely claim disabled fixtures were available. Genuine email/SMS/payment/video/identity/storage activated credentials, live delivery, monitoring and recovery remain UNTESTED.
- `M3.12.04`: Real disposable PostgreSQL16 custom archive plus private object restore preserved active Worker case, committed answer, next draft, signed bytes, identity and denied foreign access; isolated server confirmed stopped. Protected final staging backups, data volume, user sessions, rollback under traffic, on-call incident and production restore SLAs are not verified.

**ENGINEER:** scoped source PASS only; additional cross-role UI, persistence and code review pending. **CYBERSECURITY:** targeted assertions only; full manual/automated authenticated pentest pending, high/critical open count UNKNOWN. **REVIEWER:** no complete independent original-scope signoff, adapter/provider evidence incomplete as noted. TECH FULL = 0.
