# ZERO-R89–R98 — Original duplicate Worker ID, Company verification and organization tests

**Ten distinct original Masterplan IDs, one exact named source test per R batch. 10/10 SCOPED PASS on official frozen `7ff30ea140a5145e5d5ba761f7c7aef24c895269`. Technical fully verified remains 0/218, original 58 deterministic batches open.**

Production and protected stage not mutated. **All ten first-attempt test processes passed, 1 TAP PASS / 0 FAIL / 0 skipped each**. Separate private PostgreSQL16 listened **only** on 127.0.0.1, with SCRAM password; separate disposable databases created/dropped in selected tests. At teardown no test databases or active clients, cluster stopped and data/secret deleted. Real stage retained HTTPS200, private PG16 and outbox alive.

**Attestation precision:** the private raw configuration shorthand "source-signed" refers only to a Git-SHA-pinned source, NOT a signed or independently attested source-to-build artifact. That chain remains a release blocker. Private immutable receipt clarification SHA256 `b68c51edc8946f958c89d6a912c4496e1ee891ee84317f0c18dc90cd68334bce`.

Source Git tree `e01d07918a03b78a76830b52d8ab67d853c96148` and configuration fingerprint SHA256 `a3ae9217f93e0a8083cce54a635e4cc3014d3287b9e9b995d8fbef69c005ae12`. Git QA report branch inherits two unapproved R36/R40 Company changes; exact original tested app code was a **separate clean detached 7ff** and remains unchanged. Source-pin policy must continue to fail CI for report branch until explicitly reviewed candidate source approval.

## Ten separate case/discipline results

### R89 — M1.07.07 — SCOPED PASS 1/1

**Masterplan workflow:** Duplicate document/contact signals require independent resolution.
**Exact test:** `tests/platform/worker-identity-issuance-race-postgres.test.mjs :: M1.07.07 two genuine Admins racing duplicate dispositions serialize and stale loser cannot issue Worker ID`.
- **ENGINEER — SCOPED PASS:** Two real MFA Admins used separate PostgreSQL16 transactions for duplicate Worker dispositions; only first decision committed and a fresh second revision could target a unique Worker ID.
- **CYBERSECURITY — tested-boundary SCOPED PASS:** Row locks and server revision reject stale second disposition, no silent account merge or early Worker ID before duplicate cleared; immutable single audit.
- **REVIEWER — scoped evidence accepted, TECH FULL BLOCKED:** One native real PostgreSQL16 two-Admin case with previous secure-fixture Worker registration, not complete Worker/UI identity provider integration.
- **Provenance:** app SHA `7ff30ea140a5`, original source-test-file SHA256 `8754c7a7089b766523a0bbb52a21c56dbf1dbb98c35edf144eaecf22abd3504d`, private exact raw-log SHA256 `3cb2f5c646d929fbd643d025115efce7e38f2d7267166e13b977ad1be03abc09`; exit0, TAP 1 PASS, 0 FAIL, 0 other tests skipped.

### R90 — M1.08.01 — SCOPED PASS 1/1

**Masterplan workflow:** Registration to pending dashboard and submitted scanned evidence.
**Exact test:** `tests/browser/m1-08-company-verification.browser.test.mjs :: M1.08 real Chromium acceptance covers Company registration, correction, evidence review and activation`.
- **ENGINEER — SCOPED PASS:** Actual Chromium Company owner registration, scanned evidence review, changes requested and corrected version, protected Admin fresh v2 approval, pending-to-active transition.
- **CYBERSECURITY — tested-boundary SCOPED PASS:** Old v1 Admin decision rejected in browser; corrected v2 is version-bound and authorized; no tenant activation on stale form.
- **REVIEWER — scoped evidence accepted, TECH FULL BLOCKED:** One broad real Company/Admin browser test with local fixtures, not live third-party email/storage verification.
- **Provenance:** app SHA `7ff30ea140a5`, original source-test-file SHA256 `08ed0902cddafe78751bac0581c142e6c2a8168d0343682cfa35816c687dce95`, private exact raw-log SHA256 `c8973a40d35520f783a194a86e9ff5aadb510aa9de2e54005f5da084636fc61f`; exit0, TAP 1 PASS, 0 FAIL, 0 other tests skipped.

### R91 — M1.08.02 — SCOPED PASS 1/1

**Masterplan workflow:** Pending tenant high-risk actions denied.
**Exact test:** `tests/browser/company-pending-tenant-high-risk.browser.test.mjs :: M1.08.02 pending Company remains signed in for verification but cannot invite, issue orders or purchase credits`.
- **ENGINEER — SCOPED PASS:** Pending Company could sign in to verification but not invite workforce, issue assurance orders or purchase credits; activation regained authorized capabilities.
- **CYBERSECURITY — tested-boundary SCOPED PASS:** Service/UI/DB high-risk pending-tenant claims refused with no mutation, verified Company authority correctly restored.
- **REVIEWER — scoped evidence accepted, TECH FULL BLOCKED:** Local browser and native billing/assurance scope; no real payment provider capture/checkouts.
- **Provenance:** app SHA `7ff30ea140a5`, original source-test-file SHA256 `25ca61f05db710842686ff84063d0a2df6fc9fcef49c09a0371c6a597aa24e98`, private exact raw-log SHA256 `3237bd4e387db07d57a3c2aede3ecd7560d4f3d727963e5c5620f3071970dd44`; exit0, TAP 1 PASS, 0 FAIL, 0 other tests skipped.

### R92 — M1.08.03 — SCOPED PASS 1/1

**Masterplan workflow:** Admin changes requested to corrected version to verification.
**Exact test:** `tests/platform/company-verification.test.mjs :: M1.08.03 stale Admin version one review cannot decide a corrected version two without re-review`.
- **ENGINEER — SCOPED PASS:** Admin stale v1 review is rejected after Company resubmits scanned v2; fresh version-bound decision approves only v2 and activates tenant.
- **CYBERSECURITY — tested-boundary SCOPED PASS:** Replayed/stale decision returns conflict while v2 remains under review, old PDFs and versions retained; no activation audit before fresh decision.
- **REVIEWER — scoped evidence accepted, TECH FULL BLOCKED:** Native DB plus optional isolated PG16 regression, one selected exact test, not complete browser/adapter sweep.
- **Provenance:** app SHA `7ff30ea140a5`, original source-test-file SHA256 `a20550b3d72911e24db897228043064387d04c1397f6552b76f6a53a170cd742`, private exact raw-log SHA256 `f00ad1992dfed5f5ee2a13fab893cd39af81f7e4d15b3b62727bbdadf7cbfdf1`; exit0, TAP 1 PASS, 0 FAIL, 0 other tests skipped.

### R93 — M1.08.04 — SCOPED PASS 1/1

**Masterplan workflow:** Admin rejection remains pending and preserves original history.
**Exact test:** `tests/platform/company-verification.test.mjs :: M1.08.04 terminal Company rejection preserves pending tenant, original evidence and denies stale resurrection`.
- **ENGINEER — SCOPED PASS:** Terminal Company rejection retains submitted document/evidence and original Admin audit; Company remains pending.
- **CYBERSECURITY — tested-boundary SCOPED PASS:** Stale approve/reject, review reopen, edit/resubmit/withdraw resurrection denied; zero fake verified audits and private evidence persists.
- **REVIEWER — scoped evidence accepted, TECH FULL BLOCKED:** One native review/history contract, not all Company appeal and consumer-visible rejection messaging.
- **Provenance:** app SHA `7ff30ea140a5`, original source-test-file SHA256 `a20550b3d72911e24db897228043064387d04c1397f6552b76f6a53a170cd742`, private exact raw-log SHA256 `83a589f5089b65bca6c83cdba90c126b69cd98cc80a81872d804de600c4cfca0`; exit0, TAP 1 PASS, 0 FAIL, 0 other tests skipped.

### R94 — M1.08.05 — SCOPED PASS 1/1

**Masterplan workflow:** Approval activates tenant; stale/double decision denied.
**Exact test:** `tests/platform/company-verification.test.mjs :: M1.08.05 two Admins race Company final approval or rejection on real PostgreSQL16`.
- **ENGINEER — SCOPED PASS:** Genuine PostgreSQL16 two Admin concurrent final approval/rejection races; verified winner activates and rejected winner leaves pending; only one audit each.
- **CYBERSECURITY — tested-boundary SCOPED PASS:** Losing decision denied, stale retry denied and versions/PDF retained, no double activation or contradictory terminal states.
- **REVIEWER — scoped evidence accepted, TECH FULL BLOCKED:** Actual two-actor DB concurrency covered; full browser MFA/notification provider side effects remain outside this one case.
- **Provenance:** app SHA `7ff30ea140a5`, original source-test-file SHA256 `a20550b3d72911e24db897228043064387d04c1397f6552b76f6a53a170cd742`, private exact raw-log SHA256 `aaf559015fefabf5209a1cd203b563c2ddf23cbdb9a8669c16f9b958153b0209`; exit0, TAP 1 PASS, 0 FAIL, 0 other tests skipped.

### R95 — M1.09.01 — SCOPED PASS 1/1

**Masterplan workflow:** Site and department create, edit, archive and restore.
**Exact test:** `tests/platform/company-organization-team.test.mjs :: M1.09.01 actual PostgreSQL16 two Company staff race site archive and department edit with strict unit revision`.
- **ENGINEER — SCOPED PASS:** Genuine PostgreSQL16 concurrent Owner/Admin site archive versus department edits; stale modifications refused, authorized fresh restore commits with revisions.
- **CYBERSECURITY — tested-boundary SCOPED PASS:** Tenant-bound roles cannot apply stale edit or foreign restore; four immutable unit audit records and revised history preserved.
- **REVIEWER — scoped evidence accepted, TECH FULL BLOCKED:** Native PG16 concurrency and audit; UI mobile and all organization actions not full-certified.
- **Provenance:** app SHA `7ff30ea140a5`, original source-test-file SHA256 `14245195b0f22e32b104e4c0df4f1012bfb9b53f6107ce0ef660fb321b0e0d51`, private exact raw-log SHA256 `d38abe9e919231f10b2acafc6b55b7201d5313966fded7f6f2c1687eb3164a8f`; exit0, TAP 1 PASS, 0 FAIL, 0 other tests skipped.

### R96 — M1.09.02 — SCOPED PASS 1/1

**Masterplan workflow:** Archive assigned units unassigns placements and retains history.
**Exact test:** `tests/platform/company-organization-team.test.mjs :: M1.09.02 actual PostgreSQL16 concurrent archive versus new Worker placement retains Worker receiving state and immutable audit`.
- **ENGINEER — SCOPED PASS:** Genuine PostgreSQL16 archive versus new Worker site/department placement interleaving preserves Worker receiving state and placement history.
- **CYBERSECURITY — tested-boundary SCOPED PASS:** No Worker placement onto archived scope after lock, SQL rollback/reapply retains row lock and immutable audit.
- **REVIEWER — scoped evidence accepted, TECH FULL BLOCKED:** Real PG16 both unit types; full Worker receiving UI and external company adapter not certified.
- **Provenance:** app SHA `7ff30ea140a5`, original source-test-file SHA256 `14245195b0f22e32b104e4c0df4f1012bfb9b53f6107ce0ef660fb321b0e0d51`, private exact raw-log SHA256 `c23d95bc2257387b56dcfa53ec5e84f9e23efdac00a771e484583cc97500f54f`; exit0, TAP 1 PASS, 0 FAIL, 0 other tests skipped.

### R97 — M1.09.03 — SCOPED PASS 1/1

**Masterplan workflow:** Archived units cannot receive new placements.
**Exact test:** `tests/platform/company-organization-team.test.mjs :: M1.09.03 actual PostgreSQL16 Company Team placement and invite acceptance race against archived units`.
- **ENGINEER — SCOPED PASS:** Genuine PostgreSQL16 site/department Team placement and invitation acceptance races against archive; previous valid Team history retained.
- **CYBERSECURITY — tested-boundary SCOPED PASS:** New or stale acceptance/binding denied after archive; foreign-tenant operations refused; 0132 migration rollback preserves locks.
- **REVIEWER — scoped evidence accepted, TECH FULL BLOCKED:** Native PG16 Company Team workflow; actual invitation email and downstream Worker/Team browser screens pending.
- **Provenance:** app SHA `7ff30ea140a5`, original source-test-file SHA256 `14245195b0f22e32b104e4c0df4f1012bfb9b53f6107ce0ef660fb321b0e0d51`, private exact raw-log SHA256 `705ce57ca4ca28599a00166c808a38057d587e21a8b4e2f9451e430b99143532`; exit0, TAP 1 PASS, 0 FAIL, 0 other tests skipped.

### R98 — M1.09.04 — SCOPED PASS 1/1

**Masterplan workflow:** Team invitation, MFA enrollment, role permission update.
**Exact test:** `tests/browser/m10904-company-team-stale-permission.browser.test.mjs :: M1.09.04 actual Chromium two Company staff stale same-role permission forms cannot resurrect revoked access`.
- **ENGINEER — SCOPED PASS:** Two Company staff real Chromium sessions: Owner removes workforce grant; stale Admin role form fails; fresh approved version persists and Owner reload sees revision.
- **CYBERSECURITY — tested-boundary SCOPED PASS:** Stale replay cannot resurrect revoked live authority; newer authorized revision and actor audit persisted; browser at 390px.
- **REVIEWER — scoped evidence accepted, TECH FULL BLOCKED:** One browser permission-revocation path, not all staff MFA invitation, desktop/mobile or tenant attacks.
- **Provenance:** app SHA `7ff30ea140a5`, original source-test-file SHA256 `36ba4c9df671249a228e1f2cef96d353ccff7bfc6855307925e60faa846a3694`, private exact raw-log SHA256 `3b6f996093781d771cbe504535420842eb67ea8996353b8cb98d11c9148426fb`; exit0, TAP 1 PASS, 0 FAIL, 0 other tests skipped.

## Reconciliation, security release blockers and exact handover

- **Evidence:** private ten-case triple-discipline JSON `/home/ubuntu/work/.hse-qa-tmp/agency-zero-r89-r98/R89-R98-three-discipline-verified-receipts.json` SHA256 `e5a9a31f663207102872ecbe67a137574250a719a4015df56fc918f44e4844d4`; original case progress JSON SHA256 `8d93ffc35ad94e6081854431c5c1b0a9f7a5b8284c68af00f3f549d2b2da1491`; private PostgreSQL16 clean teardown SHA256 `e21651f029664ccf753e7dc4b79a646239ce26168317174ea3ccf384a5c854e1`. Private DSN/password file and cluster data deleted after passing cases; raw logs retained in 0700 private directory.
- **Coding and exact SHA:** original app source checkout remained Git clean and unchanged on 7ff. No preexisting historic green claims were overwritten. Three discipline decisions are evidence assessments made in this AI verification process, **not independently retained human expert signatures or separate external agency certifications**.
- **Not fully verified:** all six-role browser/mobile positive, negative, cancel/retry for every selected workflow; end-to-end notification receiving routes for each newly scheduled and rejected Company action; real email/SMS/ID/video/payment/antimalware/storage adapters; independent manual penetration, performance/load and safe stage restart/rollback on final reviewed candidate.
- **Live release NO-GO:** inherited R36 CSV/R40 Company accessibility changes still not approved/pinned in docs/qa/AGENCY_ZERO_CANDIDATE.json, QA CI expected fail-closed; protected stage current QA-docs HEAD and release pin mismatch blocks safe restart, metadata stale d204, no independently signed source-to-artifact chain and no retained fresh backup / approved stage switch. Never repin silently.

**NEXT R99:** continue original M1.09.05 and M1.09.06 Company Team suspension and grant ceilings, then M1.10 Worker invitation/cross-tenant linking workflows. Do not duplicate already-passed source-only cases unless relevant source SHA changed or untested dimensions are added.

**TECH FULL 0/218 | OWNER TESTING READY NO | PRODUCTION UNCHANGED.**
