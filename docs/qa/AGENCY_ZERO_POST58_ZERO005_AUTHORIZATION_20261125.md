# Original ZERO-005 / 058 — Authorization, tenant and Worker isolation

**CURRENT OWNER-TESTING VERDICT: NO.** Five NEW exact-source test cases on frozen 7ff30ea140a5145e5d5ba761f7c7aef24c895269 were scoped **5 PASS, 0 FAIL, 0 SKIP**, but all four original M1.04.01-.04 remain **SCOPED_PASS_NOT_FULL**. Full technical verification stays **0/218**. Prior original ZERO-005 four real Chromium browser cases 4/4 were already evidenced and were **not rerun**.

The new checks are service/source-level with isolated synthetic PGlite, not 5 new real-browser E2E tests. Compiled secure-file service in new private scratch from exact source (13 JavaScript modules) and no protected stage, production, or product source changed.

## Four original workflows / three independent discipline assessments

### M1.04.01 — 1 fresh named source cases

- Source test: every accepted protected endpoint is bound to one fixed portal role. File tests/platform/authorization-final-isolation-suite.test.mjs SHA256 77bb92323c135a8bad0de3cd9ae1267b5283bde6f59ff49fd71c01bb24631d18. Actual TAP pass1 fail0 skipped0, exit0. Raw log SHA256 2f9f7a71e4f10465c2438106778e2ccb02a6fb6fe5d63a1fe6ad24f26d3b95be.

**ENGINEER:** One new SOURCE-STRUCTURE test PASS checks exact portal-layout fixed-role guards across 11 protected route examples. Original independent prior real Chromium Admin Server Action denial for five other roles and anonymous was already scoped PASS and was not rerun.

**CYBERSECURITY:** Role guard structure/previous cross-role POST replay scoped only. No comprehensive reachable endpoint-method inventory, forged role/cookie/CSRF server action matrix or manual authenticated exploit attempt against every route.

**REVIEWER:** Verified test checks exact layout source but does NOT run an actual browser in this new case. Historical Admin Server Action browser case remains prior scoped evidence. Full six-role UI/code security independent signoff not awarded.

**STILL BLOCKED:** Manual full six-role endpoint and Server Action attack matrix, authenticated tenant/role forged and revocation tests, visual/a11y and independent review.

### M1.04.02 — 2 fresh named source cases

- Source test: Member scope, tenant isolation, permission ceiling and fresh session checks hold at the report boundary. File tests/platform/report-company-generation-runtime.test.mjs SHA256 d85efce5f337ea40e6042d45652d6576742fac31e5dbd03071efc25674bde743. Actual TAP pass1 fail0 skipped0, exit0. Raw log SHA256 e68abd982aac1c86b96aa7dcff476a8fe448cbd825da5ce830a08932cb1f535c.
- Source test: A matching digest cannot authorize another tenant's private report object. File tests/platform/report-company-generation-runtime.test.mjs SHA256 d85efce5f337ea40e6042d45652d6576742fac31e5dbd03071efc25674bde743. Actual TAP pass1 fail0 skipped0, exit0. Raw log SHA256 fc0d63e8698c8dc5a9c6bc2d647dcd109fd09d91cce9c8404741a4a503dc9af3.

**ENGINEER:** Two NEW disposable PGlite report service tests PASS: member site filter and permission ceiling, revoked session and foreign report ID denied; a genuine artifact/hash copied into wrong tenant metadata cannot authorize another tenant private report object. Original Company A/B secure PDF browser paths previously scoped green, retained.

**CYBERSECURITY:** Direct runtime tenant/permission checks and corrupt-metadata same-digest BOLA attempts fail closed, owned report still downloads. Not an authenticated HTTP inventory across all exports or real storage provider, nor scanner/pentest completion.

**REVIEWER:** Source title, PGlite status and exact raw hashes verified; positive scoped worker rows and negative mismatches, but not complete browser CSV/PDF/print and privacy/a11y review.

**STILL BLOCKED:** Real HTTP all report filters/CSV/PDF and other private objects, concurrency, external private storage+scan adapter contracts (if applicable), complete UI and independent penetration signoff.

### M1.04.03 — 1 fresh named source cases

- Source test: Worker signed access reuses safely while live and fails after session revocation. File tests/platform/secure-file-access-runtime.test.mjs SHA256 f64f0fe12e125dfedd2664f5d140271dbb53cc42ccc2ac817a0608c406e67053. Actual TAP pass1 fail0 skipped0, exit0. Raw log SHA256 1a192fc411db895d8293823226632b1b2a996c87d40ef1facab4a99cf1b3b1af.

**ENGINEER:** One NEW isolated compiled secure access core + real PGlite test PASS: Worker A signed token reuses while active, Worker B cannot issue access for A file, and after Worker A session revocation old token is denied BEFORE storage bytes read. Prior A/B real browser IDOR/capability tests retained, not rerun.

**CYBERSECURITY:** Cross-worker file reference/signed-token replay after session revocation denied; storage read call count proves no bytes fetched after revocation. Other worker resources, device/session variants, attack against actual object-storage URL parser and leaked tokens not complete.

**REVIEWER:** Private compilation of 13 application runtime modules matched frozen source, compiled only under private scratch; direct service test is not a fresh browser/UI test. Existing real Worker A/B browser remains historical. Final independent API/UX signoff missing.

**STILL BLOCKED:** Full cross-worker record types and direct APIs, concurrent revoked/cached credentials, cross-site signed URL misuse, full adapter storage contract and independent reviewer.

### M1.04.04 — 1 fresh named source cases

- Source test: transactional authorization revalidation denies every accepted lifecycle and permission race. File tests/platform/authorization-final-isolation-suite.test.mjs SHA256 77bb92323c135a8bad0de3cd9ae1267b5283bde6f59ff49fd71c01bb24631d18. Actual TAP pass1 fail0 skipped0, exit0. Raw log SHA256 3631e8a80ef24084a7c77795f8c50c4450413744f02e6ba6ddd26c652c1ca68b.

**ENGINEER:** One new disposable PGlite transactional authorization fixture PASS: FOR UPDATE guard revalidates session, account, suspended tenant, membership and role/lifecycle changes before accepting record mutation. Earlier Company portal real owner-to-team/report workflow scoped pass reused.

**CYBERSECURITY:** Checks fail-closed locking/lifecycle permission changes in fixture. Does NOT establish all production Server Actions revalidate at mutation time, nor true multi-process PostgreSQL contention and stale grants across six roles.

**REVIEWER:** Compared fixture assertions with original lifecycle contract; not an external/manual pentest nor full Company/Worker UI post-revocation acceptance.

**STILL BLOCKED:** Real PostgreSQL concurrency and company team membership race, every affected Server Action post-revocation, full notifications/downstream reports, a11y, independent security and reviewer approval.

## Evidence integrity, limitations and release guard

- Private combined test-case/three-role report: /home/ubuntu/work/.hse-qa-tmp/agency-zero-post58-zero005-authorization/ZERO005-four-scenarios-five-cases-three-disciplines.json SHA256 517158c387d381621d96364ec841d4a54c15feb0978c2d1db5804e3262c6ac97. Individual logs/immutable receipts with exact source SHA, test source SHA, Node version, configuration fingerprint, command, timestamps, observed TAP and digest are listed in that private JSON. Source git HEAD and index clean. No actual user data was used.
- M1.04.01 fixed_portal_role: raw SHA 2f9f7a71e4f10465c2438106778e2ccb02a6fb6fe5d63a1fe6ad24f26d3b95be, receipt SHA b96dec373aaad1fabdf8b90c9d09b56875e960e8b96f6d196b82f84c86a3217e, config SHA d3e89033d00fd04c5920bfeb7a7ae19d3905f6e443e362b3f51c39a074fb9d9f.
- M1.04.02 scoped_report_boundary: raw SHA e68abd982aac1c86b96aa7dcff476a8fe448cbd825da5ce830a08932cb1f535c, receipt SHA f89549aa97505db3cf763cd8dc743d01d842b348c64b687215acd70ef771eabb, config SHA ddf3d49fda59844d4d76d1b28ead74de2ff594e3f9cd2c32188d91a0cb74c23f.
- M1.04.02 foreign_report_artifact_digest: raw SHA fc0d63e8698c8dc5a9c6bc2d647dcd109fd09d91cce9c8404741a4a503dc9af3, receipt SHA 6db86b3e7dbfe366c9e9b6c418701f970f95a812d7eed91ca04d334124c33980, config SHA f9169017c3e9496db1bc72194e527a7b8121b5cac642fca43b6b77a319c134c1.
- M1.04.03 worker_signed_token_revocation: raw SHA 1a192fc411db895d8293823226632b1b2a996c87d40ef1facab4a99cf1b3b1af, receipt SHA 11fae7af21119ec1101788428ebc7b88e1ccede91b0193f712a7f1ecc9145ae6, config SHA c8e720edc09cc20609192f428441196879f5dbec38437cdceef92d20385878bf.
- M1.04.04 transactional_permission_lifecycle: raw SHA 3631e8a80ef24084a7c77795f8c50c4450413744f02e6ba6ddd26c652c1ca68b, receipt SHA c239827e1775f55b98c16f1b8b3afe3d220d585d8118e2004e7a52fe15e9a657, config SHA 21f6019264762325e93e8ecb6332ee6f2bfc99ec9ed9988053415c3951c42ab3.

- No complete OWASP manual authenticated pentest across every endpoint, role, tenant, Worker resource, race/CSRF/BOLA/IDOR. Full-scope high/critical count **UNKNOWN**, not zero. Detailed page UX, WCAG/keyboard/mobile, full reviewer acceptance, and applicable provider-adapter contracts remain. Reviewing AI is not an external accredited cyber agency. A passed selected source test is NOT a feature certification.
- Release blocker from independent prior QA PR224 hosted audit #45603019052 on QA91702d8 remains terminal **FAILED** due Verifier/Case Replay score inputs 0 expected2; separate same source case on frozen pin7ff passed but different changed QA SHA/config. No silent repin, merge, staging source attestation or approved rollback.
- All 58 original batches already attempted and all 58 revisit buckets still OPEN; original 218 immutable scenario IDs maintained. TECH FULL 0/218. No new R-series.

## NEXT

Original **ZERO-006/058: M1.05 Audit and notifications**, four related workflow units (transition audit history, recipient notifications/deep links, six-role read/unread badges, outbox retry/idempotency). Inspect old exact-source evidence before scheduling up to five new source cases. Continue keeping ZERO-001 through ZERO-005 unresolved scenarios visible, no repetition of these five passing tests.
