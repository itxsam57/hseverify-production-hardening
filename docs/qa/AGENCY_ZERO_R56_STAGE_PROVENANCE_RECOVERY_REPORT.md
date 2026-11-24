# ZERO-R56 — Pinned stage build provenance and non-invasive restart-recovery audit

**Original related scenario:** M1.01.04. **Five bounded read-only checks only** on EXISTING private loopback HTTPS stage. **3 scoped PASS, 2 FAIL/release blockers.** **TECH FULL 0/218, OWNER TESTING READY NO.** No additional original scenario certification, production change, stage process stop/start, shared DB mutation or external provider call.

**Official app pin remains** `7ff30ea140a5145e5d5ba761f7c7aef24c895269`. The separate R36+R40 QA integration `ebc31796b4a11d2d0b52b9cf7caa627bfd42d7ea` is NOT deployed in this stage. The private stage's current QA-only HEAD is `6a446de2f52e6866708c9bb7e750618660617443`, while its checked-out `src` Git tree and frozen 7ff source tree are exactly equal at `e01d07918a03b78a76830b52d8ab67d853c96148`.

## Five actual checks (one original-related workflow)

| # | Read-only unit | Measured result | Status |
|---|---|---|---|
| 1 | Source tree / live process / localhost HTTPS | Stage process env `HSE_RELEASE_SHA=7ff30ea1`, process cwd `.next/standalone`, private PostgreSQL/worker present and HTTPS `/worker/login` responds 200. Exact `HEAD:src` equals `7ff30ea1:src`. | **SCOPED PASS** |
| 2 | Next.js build/standalone provenance | Root and standalone `BUILD_ID`, `required-server-files.json` and `server/app-paths-manifest.json` are byte-identical; build manifest `config.deploymentId` equals full pinned 7ff SHA; actual Next server cwd matches standalone. Manifest SHA256 `6a71e2b022f5e15507e0b23e740231c4f840c164b6153676dcdd6264280859f7`. | **SCOPED PASS** |
| 3 | Stage metadata integrity | `stage-metadata.txt` still records `d2043b50e3945d2f219356dc5942e4a3710a56d5`, not current pinned/running `7ff30ea1`; metadata SHA256 `9edf10827d10c12cf2702ff62c4f34435751662b6b4706495c7ab067547257c4`. | **FAIL (stale provenance metadata)** |
| 4 | Recoverability without restart | Both existing `start.sh` and `start-app.sh` compare `HSE_RELEASE_SHA` directly with `git rev-parse HEAD`. Executed only the exact equality predicate in a harmless shell, **exit 1**, because current HEAD `6a446de2` is not pinned `7ff30ea1`. Live restart was **NOT** attempted. | **FAIL (stage would refuse restart on current shared checkout)** |
| 5 | Backups and past isolated restore receipt | All 3 current PostgreSQL custom dump archives decode via `pg_restore --list` exit0 and baseline sidecar digest matches. Earlier 7ff isolated restore evidence reports **PASS** with 193 tables, 693 rows, matching data fingerprint, six login pages and two auth denials. Older restored-archive hash is **not** among the current named archives. No fresh recovery test performed. | **SCOPED PASS — historic/structural, not current restore signoff** |

Note: The build manifest's deployment ID is self-declared build metadata and its hashes do not prove a separately signed source-to-binary chain. This is much stronger than relying on runtime env alone, but **not** final verifiable provenance. Prior isolated restore receipt is genuine historical evidence, not proof a current backup was just restored.

## Three discipline results

- **ENGINEER — FAIL for recovery readiness:** Existing app and compiled Next assets locally coherent, but exact restart preflight denies on QA HEAD drift even with identical source tree; operator restart/runbook blocked. Source code remains untouched.
- **CYBERSECURITY — SCOPED only:** Strict SHA guard is correctly *fail-closed* and was not bypassed; it currently creates availability/recovery risk. Only local pinned TLS, existing local security receipt, file checksum and backup TOC were inspected. No external-trusted TLS, live provider tests or full authenticated penetration campaign.
- **REVIEWER — BLOCKED, no TECH FULL:** Stage metadata disagrees with actual current build, original R38 proof was not promoted, prior restored archive's SHA does not match current named files, no fresh isolated restore or separate independent reviewer identities. Original M1.01.04 remains **BLOCKED_CANDIDATE_STAGE_PARITY_AND_RESTART**.

**Private evidence:** `/home/ubuntu/work/.hse-qa-tmp/agency-zero-r56/R56-five-readonly-stage-checks.json` SHA256 `342490d4d387fdd2cd1628f6c00952a4d228a43315d5d973f1c013d9ea92beaa`. Configuration fingerprint `031ca42a49dce9c062d1436f63e6315bdf1aee54c0842dfe4b91cd5dd380c9c6`. Separate authenticated readiness 401/200 evidence is in earlier R38; **not double-counted** here.

## Non-disruptive root-cause fix path (NEXT R57)

1. Create a **separate clean immutable stage checkout** at the exact pinned commit `7ff30ea1` while existing shared stage keeps running. Prefer returning the existing strict SHA comparison to green; **do not weaken it** into comparing only `src`, nor change live checkout or metadata in place.
2. Capture independent signed build-asset SHA and config fingerprint on that checkout; verify same standalone buildId, deploymentID, database migrations/schema and actual live preview via **isolated ports/DB**. Do not reuse production-like shared ports or staging credentials.
3. Perform fresh PostgreSQL custom archive restore to a new disposable socket-only database and run six-role auth positive/negative tests; verify recovery from the exact stored archive. Only after separately reviewed proof should an operator plan the live-stage switch/restart and update stage metadata atomically.
4. R36 CSV and R40 header patch remain a **different unintegrated QA candidate**. Explicitly review/re-pin a future integrated owner-testing candidate and run full independent hosted CI, penetration testing, UI and adapters at identical SHA; do not auto-promote receipts.

**PR #226 hosted CI terminal:** ten checks PASS, two intentional source-pin integrity FAIL. This R56 stage analysis is of the **original 7ff stage**, not the proposed integrated QA source. **Production unchanged.**
