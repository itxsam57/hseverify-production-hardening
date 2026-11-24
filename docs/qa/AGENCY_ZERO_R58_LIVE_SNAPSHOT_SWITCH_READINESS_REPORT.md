# ZERO-R58 — Fresh live stage snapshot / release-switch readiness verification

**Masterplan original workflow M1.01.04. Five bounded related units (4 SCOPED PASS, 1 BLOCKED). TECH FULL = 0/218. Owner testing readiness NOT YET.**
Actual UTC execution: 2026-11-24T12:27:27.667554+00:00 through 2026-11-24T12:27:34.227051+00:00. Exact running stage original app pin: 7ff30ea140a5145e5d5ba761f7c7aef24c895269. R58 QA reporting branch is documentation-only relative to the integrated R36/R40 QA draft. Production and existing loopback stage were not changed.

## Five real results

| # | Unit | Result | Actual proof |
|---|---|---|---|
| 1 | Running release / read-only source identity | **SCOPED PASS** | Private HTTPS login 200, PostgreSQL and outbox alive, `HSE_RELEASE_SHA=7ff`; stage HEAD `6a446de2f52e6866708c9bb7e750618660617443` has exact same `src` Git tree as 7ff and clean detached 7ff checkout available |
| 2 | **New live PostgreSQL16 custom snapshot** | **SCOPED PASS** | Ran actual `pg_dump -Fc` of currently running synthetic stage against existing protected PG16, generated private `PGDMP` archive SHA256 `9c4931fec1fc2ed91a1367969d8d238dd68142b2810034a81e9ec0a59b9a5e41`, 1668012 bytes, 1769 valid TOC entries; archive not committed |
| 3 | **Actual isolated PG16 restore, all-table equality** | **SCOPED PASS** | New UNIX-socket-only PG16 cluster, actual `pg_restore --exit-on-error`; **193 restored public tables and 979 rows**. All per-table row-count/canonical-hash pairs matched current live source; overall content fingerprint `b5417393d3eb532b99d8b1c734f1e1022ed9495919146937d0e87a829286a6bf` equal to source |
| 4 | Source consistency during dump+restore | **SCOPED PASS** | Reran all-table source digest after isolated restore; live before/after table fingerprints identical, 979 → 979 rows, no concurrent drift detected. This does not prove future writes cannot occur or guarantee zero downtime |
| 5 | Strict safe stage-switch / metadata recovery | **BLOCKED_RELEASE_RECOVERY** | The **existing** shared worktree HEAD `6a446d` still fails its strict `HSE_RELEASE_SHA == git rev-parse HEAD` predicate (exit1) even though source tree matches. Separate clean pinned7ff checkout passes (exit0). Stage metadata still labels `d2043b50e3945d2f219356dc5942e4a3710a56d5`, not the actual live release. No switch/restart attempted. Signed source-to-binary proof and operator approval absent |

**Fresh data comparison:** R57 restored an **existing November 21 backup** with 193 tables / 693 rows; R58 restored a **newly captured current synthetic-stage dump** with 193 tables / 979 rows. They represent different points in time; R57 does not represent the newest state. The new archive was deleted after checksum and restore verification; it was not installed as a retained recovery backup.

## Independent discipline review

**ENGINEER — SCOPED PASS for fresh restore; release restart FAIL/BLOCKED.** Full table/row fingerprint parity and stable source observed. A clean pinned checkout solves the SHA comparator in an isolated context. The running stage still cannot safely restart on its present checkout.

**CYBERSECURITY — SCOPED PASS for isolated backup integrity; full pentest INCOMPLETE.** Source was read with `SELECT`/`pg_dump` only; PostgreSQL restore had `listen_addresses=''` and a private Unix socket; scratch archive and cluster deleted, stage source/credentials not exposed. The strict SHA guard remains fail-closed, not bypassed. Live external provider/TLS trust, authenticated multi-role attack coverage, scanner campaign and signing still missing.

**REVIEWER — SCOPED evidence accepted, TECH FULL BLOCKED.** Fresh snapshot and digest comparison do **not** constitute a signed immutable backup retained for rollback, a verified application source-to-build attestation, or an authorized operational switch. Three review disciplines here are AI-guided QA checks, not independent human-agency certification. Full original M1.01.04 still open.

## Integrity and safe next action

- Private JSON `/home/ubuntu/work/.hse-qa-tmp/agency-zero-r58/R58-five-bounded-cases.json` SHA256 `bdce577f353ad691881096c5a18d12a5254f934b265f3db7d5f1151486e742e8`.
- Private execution stdout `/home/ubuntu/work/.hse-qa-tmp/agency-zero-r58/R58-runner.log` SHA256 `4fc366263bd71a7d0941fba0686b5ed40c77d523d072e2bc7ed7f6e29b2500c2`.
- Nonsecret tested source/DB/switch configuration fingerprint SHA256 `f279c37068e65bf5abdd8d8f490be2d58a0f5b4b690d46c7877466ea7d29b5f1`. No row content, auth secrets or dump files committed.
- Original 218 scenarios, 58 deterministic batches, 1,611 historic source-case ledger, 4,975 intended slots and frozen candidate `docs/qa/AGENCY_ZERO_CANDIDATE.json` are unchanged. `agency_zero_control.py --check` correctly refuses separate unapproved R36/R40 app source drift in this **report branch**, not a new failure caused by the snapshot.

**NEXT R59:** Prepare a reviewable, non-disruptive operator **stage switchover/rollback manifest** targeting immutable 7ff checkout with strict guard intact. Verify fresh retained-backup policy, signed build provenance and stage metadata atomic update requirements *before* approval. Do not change the running stage, stage private.env, stage metadata or production without explicit authorized review. Then resolve the integrated R36/R40 app candidate and exact-SHA full security/UX/adapter tests. **OWNER READY NO.**
