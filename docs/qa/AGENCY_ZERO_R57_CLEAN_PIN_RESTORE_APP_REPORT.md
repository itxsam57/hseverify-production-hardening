# ZERO-R57 — Original M1.01.04 stage recovery on a clean exact SHA checkout

**Five bounded scoped checks: 5 PASS / 0 FAIL. Fully verified original scenarios: 0/218.** Production and shared live stage unchanged.

## Exact source and isolated configuration

Frozen app SHA: 7ff30ea140a5145e5d5ba761f7c7aef24c895269. Isolated detached worktree: /home/ubuntu/work/hseverify-zero-r57-pinned7ff-immutable. Git HEAD clean and matches exact official pin. Configuration SHA256: fe8351d0464dcd2b3be29c376f83e60ec37ea1fdb1e35120ea801c82db54e214.

The QA evidence branch follows R56 but is not the official app candidate. The installed R36/R40 source fixes remain a separate, unapproved QA-only integrated source.

## Five completed case checks (one original M1.01.04 workflow)

1. **Source / strict SHA guard — scoped PASS:** exact clean pinned git checkout HEAD and source tree; safe equality predicate accepts correct release SHA (exit0), rejects deliberately wrong SHA (exit1). No change to live SHA guard.
2. **Build/standalone copy — scoped PASS:** copied built Next standalone binary and static files into 0700 private scratch. BUILD_ID, standalone server.js and required-server-files manifests match source artifact by SHA256, with self-declared deploymentId equal to frozen 7ff SHA. **Not an independently signed source-to-binary attestation.**
3. **Fresh PG16 database restore — scoped PASS:** actually restored the existing named Nov21 archive m10101-pre-next1646-stage7ff-20261121.dump with SHA256 6e5bc9937560e6938a72564c74b9c83e3827c3b341cc5de9a18431077d617bb4 into a brand-new Unix-socket-only PG16 instance; pg_restore exit0; 193 actual restored public tables, 693 rows, 1769 TOC entries. This is **not** a new live Nov24 backup or proof latest live DB equals the archive.
4. **Actual standalone app + restored DB — scoped PASS:** started copied Next standalone on separate 127.0.0.1 loopback ephemeral port against restored PG16 database and isolated object-store directory. All six login PAGES (worker, company, verifier, assessor, admin, root) returned HTTP200. Anonymous readiness returned 401, configured probe bearer readiness returned 200 with scope database_connection_only and release SHA7ff, unauthenticated Worker dashboard and Company CSV export redirected HTTP307. **These are six login page GETs, not successful authenticated logins for six accounts.**
5. **Isolation / safe teardown — scoped PASS:** stopped test app, stopped isolated PG16, confirmed private Unix socket absent, deleted copied artifacts and temporary database storage. Confirmed shared existing stage remained HTTPS200, private PostgreSQL and outbox running, HSE_RELEASE_SHA 7ff unchanged, release verdict NO-GO. Existing shared stage metadata is still stale d204 and its own QA-docs-only git HEAD 6a446d still cannot satisfy strict restart SHA check. The live stage was not restarted.

## Three disciplines and verdict

**ENGINEER: SCOPED PASS / LIVE RECOVERY BLOCKED.** Clean exact pin and existing backup recover in isolation; the actual shared stage still cannot restart under its unchanged strict SHA/HEAD comparison.

**CYBERSECURITY: SCOPED PASS / PENTEST INCOMPLETE.** Incorrect SHA rejected, PostgreSQL Unix-socket-only, copied standalone bound to loopback, readiness protected, protected unauthenticated API redirects. No full adversarial penetration campaign or live-provider coverage.

**REVIEWER: SCOPED EVIDENCE ACCEPTED / FULL BLOCKED.** Proven only an archived Nov21 restore, tested six public login pages and one token-bound readiness. Not a rebuilt signed binary, latest-live database backup, approved shared stage switch, authenticated full six-role workflow, or separately independent professional three-role attestations.

### Evidence/provenance

Private final JSON: /home/ubuntu/work/.hse-qa-tmp/agency-zero-r57/R57-isolated-recovery-final.json
SHA256: 9961730ac27cdf0cb30e091a6c01f81dca7af95888e48841187018505832dcc8
Private output log SHA256: 9dda724d025694f95a9c5e37fab3c0770557844dd6843431d019a2ba04285a63
Config SHA256: fe8351d0464dcd2b3be29c376f83e60ec37ea1fdb1e35120ea801c82db54e214. No sensitive archive, private.env or logs are committed.

**NEXT R58:** reconcile a NEW live-stage snapshot against a fresh isolated restore, validate source-to-build provenance and prepare a reviewed operational switch plan to the strict-pin 7ff checkout without weakening the guard. Do not mutate the running stage before explicit approval. Then resolve unmerged R36/R40 integrated candidate and run exact-SHA hosted full audit and all original 218 batches. OWNER TESTING READY: NO.
