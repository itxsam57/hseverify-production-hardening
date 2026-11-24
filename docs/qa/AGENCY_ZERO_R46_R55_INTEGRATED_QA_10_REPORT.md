# ZERO-R46-R55: ten scoped QA checks on integrated Company and credential candidate

**TEN SCOPED CASES PASS / ZERO original scenarios TECH FULL. OWNER TEST READY NO.**

- Official application pin unchanged: `7ff30ea140a5145e5d5ba761f7c7aef24c895269`. New isolated common QA tested SHA: `ebc31796b4a11d2d0b52b9cf7caa627bfd42d7ea`. App source Git tree: `e6bcc234adc75ed229a07485b1a7c7ba97f84811`.
- Exactly two application source changes relative to pinned code: `src/app/api/company/workers/export/route.ts`, `src/app/company/(portal)/workers/page.tsx`. These are the R36 CSV formula-security fix and R40 Company table accessible header fix. No production, shared staging or external provider mutation.
- Test fixture configuration fingerprint SHA256: `80c56fe58742377ddbe8fbb7cca2731ba7cfe488abc55bf6a47ece477335c1be`. Configuration fingerprint covers listed non-secret runner parameters, not live external provider configuration.
- Ten independent one-case batches, eight distinct original scenario IDs; M2.13.04 and M3.06.06 each exercised twice for different scoped checks. None awarded FULL or counted against an original batch closure.
- Six actual Chromium and four native/PGlite one-case checks, executed sequentially. Each case exit0, TAP 1 pass / 0 fail, fixture-owned data and ports, and SHA256-verified private raw log.
- Three disciplines below describe checks performed in one QA assistant session, not three independently employed reviewer identities. Independent engineer/security/reviewer full approval is NOT attested.

## Three discipline per-case evidence (one original-related case per R batch)

### R46 - `M3.06.06` - SCOPED PASS 1/1

**Original Masterplan workflow:** Cross-tenant/report/path/CSV-formula manipulation denied.
**Tested source case:** `tests/browser/company-workforce-pagination.browser.test.mjs` - Company filtered directory preserves status through Next, refresh and Previous.
- **ENGINEER: scoped PASS.** Signed-in Company Workforce browser CSV, filter/paging and real download.
- **CYBERSECURITY: scoped PASS only.** Neutralized = and whitespace-plus spreadsheet formulas; prevented forged-tenant, anonymous and revoked-role exports.
- **REVIEWER: evidence scoped accepted; FULL BLOCKED.** Real Chromium and API; no external spreadsheet launch or full staging. Separate independent signoff is missing.
- **Receipt:** source `ebc31796b4a1`, TAP 1/1 exit0, test source SHA256 `c61a5316be34d7bbcad35eb01b2f8bb2b185c7d6e5459ddf21cd1f906cf19f21`, raw log SHA256 `7e68ce63ce91c37cea4c5d1b41b045b88cacc494a576cf96644f7388a2da7438`.

### R47 - `M2.13.04` - SCOPED PASS 1/1

**Original Masterplan workflow:** Suspended, Revoked and Expired synchronize current downstream status.
**Tested source case:** `tests/browser/credential-validity.browser.test.mjs` - Browser, public API and actual PDF show the decision-pinned expiry and preserved live lifecycle.
- **ENGINEER: scoped PASS.** Actual Worker/Company credential states, public API and PDF.
- **CYBERSECURITY: scoped PASS only.** Current revoked/suspended/expired status and signed original expiry in tested path.
- **REVIEWER: evidence scoped accepted; FULL BLOCKED.** 390px Assurance columnheader accessible; no hosted full-audit clearance. Separate independent signoff is missing.
- **Receipt:** source `ebc31796b4a1`, TAP 1/1 exit0, test source SHA256 `c7dfe5a3f3d7afd7ccc77f72ae1c9b7174d69948664794402ade20b6fce72272`, raw log SHA256 `9c890d20cf8735515be4076f5b16181f841f1e2b9ac1709c3a9d847e2dc32804`.

### R48 - `M1.10.01` - SCOPED PASS 1/1

**Original Masterplan workflow:** Single invitation accepted, resent, revoked, expired and replayed.
**Tested source case:** `tests/browser/m11001-company-worker-invitation-lifecycle.browser.test.mjs` - M1.10.01 real Chromium Company Worker invitation acceptance resend revocation expiry wrong role email and replay.
- **ENGINEER: scoped PASS.** Company invite form, Worker acceptance, reload/resend/expiry/revoke and audit.
- **CYBERSECURITY: scoped PASS only.** Wrong-Worker email, stale replay, spent and rotated tokens denied.
- **REVIEWER: evidence scoped accepted; FULL BLOCKED.** Browser cross-role plus DB audit; whole scenario other adapters still open. Separate independent signoff is missing.
- **Receipt:** source `ebc31796b4a1`, TAP 1/1 exit0, test source SHA256 `4612cdfe6b933ac9cd69c885a65cc01a9e2552acca19ea03152703e0bf668d92`, raw log SHA256 `3091d68bd4faf866a2a9baa8d911308043bd677acd5fb78296ed9cfc915687a9`.

### R49 - `M1.10.02` - SCOPED PASS 1/1

**Original Masterplan workflow:** Bulk CSV mixed valid/invalid rows and duplicate recovery.
**Tested source case:** `tests/browser/m11002-company-bulk-worker-csv.browser.test.mjs` - M1.10.02 real Chromium bulk CSV quoted valid, malformed, duplicate, empty-first-cell, retry and Worker receiver persist per row.
- **ENGINEER: scoped PASS.** Company bulk CSV malformed/duplicate row recovery, Worker receipt, audit.
- **CYBERSECURITY: scoped PASS only.** Wrong-role/anonymous denied, overflow 501 rows rejected, HTML-like input inert.
- **REVIEWER: evidence scoped accepted; FULL BLOCKED.** Real cross-role browser and DB; production staging untested. Separate independent signoff is missing.
- **Receipt:** source `ebc31796b4a1`, TAP 1/1 exit0, test source SHA256 `035ffaf341297b840ee99aaa5cf703d8bd027a1f08dd46fbefdf19bd77495dd1`, raw log SHA256 `e5578b0ba1560a576fb0785c693a2448228ca75f6ab2ecb3a33c5a75928443ce`.

### R50 - `M1.10.05` - SCOPED PASS 1/1

**Original Masterplan workflow:** Worker joins, moves placement, ends relationship and retains identity.
**Tested source case:** `tests/browser/company-worker-end-relationship.browser.test.mjs` - Company ends active Worker relationship while Worker retains identity and prior Company history.
- **ENGINEER: scoped PASS.** Company revokes active Worker relationship and Worker history remains.
- **CYBERSECURITY: scoped PASS only.** Active relationship access revoked without destroying Worker principal.
- **REVIEWER: evidence scoped accepted; FULL BLOCKED.** Browser and immutable DB audit, placement/move elsewhere in original scenario untested. Separate independent signoff is missing.
- **Receipt:** source `ebc31796b4a1`, TAP 1/1 exit0, test source SHA256 `45a39a25a940428aecd6192c53002c7f264e3261dc3cf7efb7a7f217a77547e8`, raw log SHA256 `a6da255a9b101537f3fda16a8b930997bad65eb3695d364b0064f103f7a176d0`.

### R51 - `M1.10.06` - SCOPED PASS 1/1

**Original Masterplan workflow:** Second company link preserves first employer's history and isolation.
**Tested source case:** `tests/browser/company-dual-employer-isolation.browser.test.mjs` - M1.10 dual-employer browser protects each tenant while preserving Worker history.
- **ENGINEER: scoped PASS.** Worker linked to two employers, B termination retains A active.
- **CYBERSECURITY: scoped PASS only.** Tenant foreign-case and forged wrong-Worker link ID denied.
- **REVIEWER: evidence scoped accepted; FULL BLOCKED.** Real browser two tenants and DB audit; separate independent pentest not done. Separate independent signoff is missing.
- **Receipt:** source `ebc31796b4a1`, TAP 1/1 exit0, test source SHA256 `1ab8ceecf5729a983804415bf75c958490787ed638768b8a719cdf832236fb4e`, raw log SHA256 `2d963ef258fd097237302906028ef2361e45722971d780ef61fc4e743a515241`.

### R52 - `M2.13.04` - SCOPED PASS 1/1

**Original Masterplan workflow:** Suspended, Revoked and Expired synchronize current downstream status.
**Tested source case:** `tests/platform/credential-validity-runtime.test.mjs` - Actual controlled suspension after expiry retains its original signed expiry and appends Living Record history.
- **ENGINEER: scoped PASS.** Suspension after expiry appends living record and keeps expiry.
- **CYBERSECURITY: scoped PASS only.** Signed original expiry preserved during status transition.
- **REVIEWER: evidence scoped accepted; FULL BLOCKED.** PGlite native case only, not additional browser proof. Separate independent signoff is missing.
- **Receipt:** source `ebc31796b4a1`, TAP 1/1 exit0, test source SHA256 `fb31be1a1508179c66510b5a65a6db6ad510f9ed31a34ee015f5320837f1fe1f`, raw log SHA256 `613ca7a37e76ba5b9ed2b77d93b02ffb87d017917481a4e92046ea9162ef6d83`.

### R53 - `M3.04.01` - SCOPED PASS 1/1

**Original Masterplan workflow:** Search/filter/pagination show only authorized workforce.
**Tested source case:** `tests/platform/company-workforce-pagination.test.mjs` - Directory Previous and Next preserve every active filter and omit caller-supplied scope.
- **ENGINEER: scoped PASS.** Worker directory paging preserves all filters.
- **CYBERSECURITY: scoped PASS only.** Caller-supplied tenant scope omitted in generated paging.
- **REVIEWER: evidence scoped accepted; FULL BLOCKED.** Native contract only; UI integration broader scenario missing. Separate independent signoff is missing.
- **Receipt:** source `ebc31796b4a1`, TAP 1/1 exit0, test source SHA256 `f2d0b537e380d5a562a2e9ad9e4464adb13d36608130e1d918736b065287b988`, raw log SHA256 `d3a6ae8ba918462d3e29dd79eb39d9e73f78647a0311312fa8156ddbd536c50b`.

### R54 - `M2.13.03` - SCOPED PASS 1/1

**Original Masterplan workflow:** Rejected and Reassessment Required route permitted correction/appeal.
**Tested source case:** `tests/platform/credential-validity-runtime.test.mjs` - Actual renewal rejects foreign Worker or unavailable policy provenance and rolls back accepted review.
- **ENGINEER: scoped PASS.** Foreign-Worker renewal and unavailable policy rejected.
- **CYBERSECURITY: scoped PASS only.** Renewal cross-tenant policy provenance denied and decision rolled back.
- **REVIEWER: evidence scoped accepted; FULL BLOCKED.** PGlite negative transaction, no whole appeal workflow covered. Separate independent signoff is missing.
- **Receipt:** source `ebc31796b4a1`, TAP 1/1 exit0, test source SHA256 `fb31be1a1508179c66510b5a65a6db6ad510f9ed31a34ee015f5320837f1fe1f`, raw log SHA256 `bc196b49ac9aaf0949cd61be101633eaa1aae678051d3075da76ed6602565a65`.

### R55 - `M3.06.06` - SCOPED PASS 1/1

**Original Masterplan workflow:** Cross-tenant/report/path/CSV-formula manipulation denied.
**Tested source case:** `tests/platform/report-company-generation-runtime.test.mjs` - A matching digest cannot authorize another tenant's private report object.
- **ENGINEER: scoped PASS.** Company report object digest authorization.
- **CYBERSECURITY: scoped PASS only.** Matching hash does not authorize foreign tenant storage object.
- **REVIEWER: evidence scoped accepted; FULL BLOCKED.** Native service storage contract, not real external object-store penetration. Separate independent signoff is missing.
- **Receipt:** source `ebc31796b4a1`, TAP 1/1 exit0, test source SHA256 `d85efce5f337ea40e6042d45652d6576742fac31e5dbd03071efc25674bde743`, raw log SHA256 `077f169d46494e9cdd2968fa2b4860cd70f68dc9b21fa6469b0451dacb3ba7d4`.

## Quality gates and boundaries

- TypeScript --noEmit, changed-source ESLint, historical source catalog verifier (1,611 cases, 1,436 old green, 0 full), legacy 216 verifier, 4,975 slot register, and current-release 218 ledger test 8/8 all PASS. Private quality gate logs include each SHA256.
- Official source-pin control intentionally RED exit2: agency_zero_control.py --check identifies the exact two proposed product changes. This is expected fail-closed protection, not evidence of final approval. Raw SHA256 `c8c42de0cfb4da2feef13bb1cd32fa593587ee1aa1ea41e341e8ab4391e64519`.
- No updated full independent hosted CI, whole-stage penetration campaign, physical camera/microphone/screen checks, external payment/email/SMS/identity/storage/video/scan adapters, stage build provenance and rollback, or separate independent expert attestations were performed in these ten one-case tests.
- Private complete triple-discipline receipts: `/home/ubuntu/work/.hse-qa-tmp/agency-zero-r46-r55/R46-R55-reviewer-3-discipline-receipts.json` SHA256 `472d86e7ff98aebf6b6615050948ee8393b01398f464f0006ba1cfd15591bed2`. Runner progress raw SHA256 `c2aa83e70ecd1516f8455eb95b804f2702a3ec28eb71991a6b8772900391ebfe`. Sensitive fixture logs remain off Git.

**NEXT R56:** push QA-only draft PR stacked on prior R41-R45 QA PR #225. Compare exact GitHub checks, inspect source pin failures, and obtain reviewed candidate repin/affected revalidation before changing the official candidate/cursor. Then run full protected-stage and exact-SHA hosted independent audits. All 58 original groups remain open; TECH 0/218; production untouched.
