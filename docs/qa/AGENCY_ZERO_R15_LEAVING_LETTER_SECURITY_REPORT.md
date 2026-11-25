# ZERO-R15 — M1.11.06 leaving-letter exact employment binding, safe scan and M2.02 Verifier handoff

**Pinned application source:** `7ff30ea140a5145e5d5ba761f7c7aef24c895269` (unchanged). Related **original** M1.11.06 scenario (ZERO-016) and M2.02 receiving boundary. **Five distinct tests executed, 5/5 SCOPED PASS, process exit 0.** These are five tests total in one related batch (not five original scenarios). ZERO-016 prior real Chromium leaving-letter replacement and per-file private previews (1/1 PASS, SHA256 `bc10b8fea72c8fe109188ec4be58a20171756e40b6332d530931ea2a9fa51b07`) **not rerun**.

## Executed cases

| Case | Source | Observed scoped outcome |
|---|---|---|
| R15-01 | `tests/platform/worker-evidence-migration-guards.test.mjs` | SQL guards bind a leaving-letter document only to **the same exact employment record AND version**; PASS |
| R15-02 | `tests/platform/worker-evidence-leaving-letter.test.mjs` | Copied another Worker's employment IDs cannot reserve or attach a leaving-letter document; PASS |
| R15-03 | `tests/platform/worker-evidence-async-scan.test.mjs` | Pending replacement **does not displace** a clean active attachment before scan success; PASS |
| R15-04 | `tests/platform/worker-evidence-async-scan.test.mjs` | Async leaving-letter scan finalizes binding only after verified clean availability; PASS |
| R15-05 | `tests/platform/evidence-review-queue-runtime.test.mjs` | Reviewer-facing employment review queue preserves **current leaving-letter secure-file identity** on the exact queued version; PASS |

**Private raw TAP** `/home/ubuntu/work/.hse-qa-tmp/agency-zero-r15/M1.11.06.five-linked-cases.log` SHA256 `81fa59edc977ad24b2091224a7064fae77663309a3bbf94330683cff715946fe`; process exit 0; **5 tests, 5 pass, 0 fail, 0 skipped**, 27.1 seconds. Receipt JSON in same private evidence directory.

**Source file hashes (SHA256):**
- Migration guards: `b09a251700d3f2119d8af63e46d113bdf384fd1acb2227d20c6d46b263c46646`
- Leaving-letter service tests: `dca3eaec163f19c4e285a59c04d69fdb1972a1239a29ca9e7960642f826f498a`
- Async scanning tests: `6517f8b3d66660d4a4e4592131b3e46cb02f67791cacf6ad1492d2d3190ca0a0`
- Independent review queue tests: `9cc9588216bc3c2c40215e94d543d1ffd6bfaa1715d80173029ac9d0c29a0e7f`

**ENGINEER: SCOPED PASS.** Five actual service/migration/DB/scan/Verifier queue test cases agree with source boundaries. Real earlier browser verifies Worker replacement and separate private previews; no duplicate browser run. Full cross-role combined terminal receiving and all UI variants not yet signed.

**CYBERSECURITY: SCOPED PASS.** Foreign Worker record ID misuse and unscanned/incomplete attachment replacement refused; exact version binding preserved. Full independent BOLA/CSRF/concurrency scanner and production storage/scanning-provider contracts not complete.

**REVIEWER: SCOPED PASS, NOT TECH FULL.** All five TAP test names, source file hashes and observed outcomes reconciled. Previously saved browser evidence retained. No unknown cases promoted, **0/218 TECH FULL**, owner testing not ready.

**CI:** New hosted independent full regression [45112527041](https://github.com/itxsam57/hseverify-production-hardening/actions/runs/45112527041) on exact patched CI SHA `88ba8ca5abefc82bc7c1c56a3acedc70eed21749` still **in progress** as of R15 execution. Poppler install earlier passed. Do not claim green or security clearance until terminal report.

**NEXT:** Inspect hosted CI terminal verdict and exact full evidence; classify any red (do not invent a pass). Continue 218 original scenarios under <=5 cases with three reviews and guard, starting remaining M1.11 or next scoped gap; no production mutation.
