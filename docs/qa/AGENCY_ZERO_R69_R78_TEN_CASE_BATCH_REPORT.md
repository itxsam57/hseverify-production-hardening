# ZERO-R69–R78: original Release CI, Authorization, Notifications and Evidence Upload

**Ten distinct original-scenario-related batches, exactly one actual source case/workflow per R number. Verdict: R69 BLOCKED (correct fail-closed source integrity); R70–R78 NINE SCOPED PASSES; one R75 environmental first run failed, succeeded on one isolated retry. Original TECH FULL 0/218.**

Verified source for nine actual selected source tests: `7ff30ea140a5145e5d5ba761f7c7aef24c895269`, clean detached source Git tree `e01d07918a03b78a76830b52d8ab67d853c96148`. The moving QA evidence branch inherited unapproved Company source proposals, but NO production/shared stage/source commit or official candidate pin was changed. Only ignored build output was generated in isolated test checkout.

Evidence configuration fingerprint SHA256 `4b21101f0ba21921a24f8ec91ee090d18eaba5ca35c43edcbac5f288ff4a37d2`. Ten unique original IDs and nine actual source tests (one per R70–R78); R69 is a single composite GitHub release gate check. No R batch contains more than one test/workflow.

## R69 — M1.01.03 — BLOCKED_UNAPPROVED_SOURCE_SHA

**Actual original workflow:** GitHub CI verifies exact canonical candidate.
Executed repo CI and source manifest verification: draft PR #226 terminal hosted 10 SUCCESS/2 source-integrity FAIL; QA report PR #230 terminal 2 SUCCESS/2 source-integrity FAIL, with exactly two altered app source files relative to pinned 7ff: `src/app/api/company/workers/export/route.ts`, `src/app/company/(portal)/workers/page.tsx`. Actual `python3 scripts/agency_zero_control.py --check` exit2. This correctly refuses silently repinning the proposed R36 CSV hardening + R40 Company table accessible headers.
- **ENGINEER — BLOCKED:** exact frozen candidate metadata/CI source SHA do not approve the proposed integration; no reviewed SHA retarget and affected rebuilt suite.
- **CYBERSECURITY — scoped fail-closed PASS, release BLOCKED:** strict source guard rejects application drift; independent signed source-to-build proof and full pentest missing.
- **REVIEWER — BLOCKED:** no final exact candidate CI source approval. Stage metadata stale and self-labeled build deploymentId does not equal independent signed attestation.
- **Receipt:** `/home/ubuntu/work/.hse-qa-tmp/agency-zero-r69-r78/R69-candidate-release-ci-evidence.json` SHA256 `7298032671bbac8e50cdf03cbeae29dd15224a69edf740f3e595ae9cb56eceff`. Actual shared stage remains pinned 7ff, no restart/mutation.

## R70–R78 — Nine selected exact-source cases

### R70 — M1.04.01 — SCOPED PASS 1/1

**Original scenario:** Role-bound session rejects every cross-portal combination.
**Actual case:** `tests/browser/m10401-crossportal-server-action.browser.test.mjs :: M1.04.01 real Admin Server Action POST rejects five foreign role sessions and unauthenticated replay`.
- **ENGINEER — SCOPED PASS:** Admin protected server action creates one authorized object and appends audit; five unrelated portal sessions and anonymous replay do not create another.
- **CYBERSECURITY — tested-boundary SCOPED PASS:** Actual server-action payload from Admin session replayed under Worker/Company/Assessor/Verifier/Root and signed-out, all denied with correct DB audit.
- **REVIEWER — scoped evidence accepted, TECH FULL incomplete:** Scoped server-action/role denial only, no full six-role attack matrix.
- **Provenance:** isolated exact source `7ff30ea140a5`, original test SHA256 `ddc0f0a68438f487fdb39d73b918e8eb78d18ae1713bac02d2c8c64164fee629`, one actual TAP pass / zero fail / exit0 final; source log SHA256 `c6770d56054493d1fa463c1cb92ef1f356d7b2a83c6dbb56a981c99e269bdc7c`.

### R71 — M1.04.02 — SCOPED PASS 1/1

**Original scenario:** Tenant-scoped resources, filters, files and exports do not disclose other tenant.
**Actual case:** `tests/browser/company-secure-files-cross-tenant.browser.test.mjs :: M1.04.02 two real Company browser sessions isolate secure PDF issue, preview, download, copied tokens and tenant headers`.
- **ENGINEER — SCOPED PASS:** Two Company principals use real UI and private PDF files, each downloads exactly own bytes; tenant-scoped audit retained.
- **CYBERSECURITY — tested-boundary SCOPED PASS:** Bidirectional BOLA access denied 404, copied signed tokens, spoofed tenant headers, anonymous access, range/HEAD variants and purpose misuse rejected.
- **REVIEWER — scoped evidence accepted, TECH FULL incomplete:** Company PDF/file browser and DB checks only, no production object-storage provider contract.
- **Provenance:** isolated exact source `7ff30ea140a5`, original test SHA256 `aba2d48e4f5da97518ef550e3628b4e7cd52c44d8d51803f934e7e5d7d85f441`, one actual TAP pass / zero fail / exit0 final; source log SHA256 `91e639c074aae1b5a8787f15b9bd51b04bdafb782ef16b4e28136689c220f021`.

### R72 — M1.04.03 — SCOPED PASS 1/1

**Original scenario:** Cross-worker IDs, copied capabilities and direct actions denied.
**Actual case:** `tests/browser/worker-secure-files-cross-account.browser.test.mjs :: M1.04.03 two real Worker sessions isolate secure file IDs, signed tokens, forged account hints and revoked access`.
- **ENGINEER — SCOPED PASS:** Two real Worker principals issue/preview own PDFs and keep correct source revision and audit.
- **CYBERSECURITY — tested-boundary SCOPED PASS:** Foreign Worker signed file IDs/tokens and forged hints rejected; attempted cross-worker evidence save and submit denied; old signed URL invalid on signout.
- **REVIEWER — scoped evidence accepted, TECH FULL incomplete:** Worker ownership, UI and DB trace scoped; other evidence workflows need full verification.
- **Provenance:** isolated exact source `7ff30ea140a5`, original test SHA256 `8318b9b2202bd03233dc67a3af62d34fa19b595b41f4b37d1c342b931bf4df9e`, one actual TAP pass / zero fail / exit0 final; source log SHA256 `ef385d12d814ad98dd02896ed6858e97a5908b1964c36ed9e8cbc6ceb22d9bd6`.

### R73 — M1.04.04 — SCOPED PASS 1/1

**Original scenario:** Role elevation, stale permissions, revoked session and membership fail closed.
**Actual case:** `tests/browser/company-complete-journey.browser.test.mjs :: Company owner completes organization, workforce, Team, assurance, policy, report and tenant-scope workflows in Chromium`.
- **ENGINEER — SCOPED PASS:** Complete Company owner Chromium case runs organization units, staff/team lifecycle, exports, insurance/assurance, policy, billing/report and persistence.
- **CYBERSECURITY — tested-boundary SCOPED PASS:** Permission ceiling, signed-in suspension, permanent old-cookie revocation/re-MFA, forged cross-scope, billing capture/replay/signature/refund bounds denied or idempotent.
- **REVIEWER — scoped evidence accepted, TECH FULL incomplete:** Single wide Company synthetic browser journey passed; live payment provider and all cross-role recipients/adapter contracts incomplete.
- **Provenance:** isolated exact source `7ff30ea140a5`, original test SHA256 `c3e3bb219ecbfb5651d3b8ed4d6e149bae20096a865fe1928eb90999c1068765`, one actual TAP pass / zero fail / exit0 final; source log SHA256 `c12fb5ca9a01de8ee7604c6a1d9a6d34e59e78f381079488df0d463223c1d909`.

### R74 — M1.05.01 — SCOPED PASS 1/1

**Original scenario:** Every material transition retains actor, resource, reason and immutable history.
**Actual case:** `tests/browser/m10501-company-audit-actor-history.browser.test.mjs :: M1.05.01 real two-tenant Company audit shows actor, resource, reason and immutable lifecycle history`.
- **ENGINEER — SCOPED PASS:** Two Company owners see actor, target, reason and create/rename/archive/restore history in actual mobile audit UI and immutable DB.
- **CYBERSECURITY — tested-boundary SCOPED PASS:** Tenant separation; signed-out audit denied; mutation/update/delete attempts rejected; DB actor and reason correct.
- **REVIEWER — scoped evidence accepted, TECH FULL incomplete:** One Company audit material-transition family tested, not all 218 platform audit producers.
- **Provenance:** isolated exact source `7ff30ea140a5`, original test SHA256 `f2dd18ac04000db0d9d753a605816820284f25b9b39d9e6268e3ff85bfd8a8ee`, one actual TAP pass / zero fail / exit0 final; source log SHA256 `6646444fc1f0fa1bf6c28af6bdbc6dddb7293b805d402808db03a74860e64e51`.

### R75 — M1.05.02 — SCOPED PASS 1/1

**Original scenario:** New submission/decision/assignment sends next actor correct authorized deep link.
**Actual case:** `tests/browser/interview-scheduling-notification.browser.test.mjs :: Real scheduling action delivers in-app notices through the built worker to three authorized record links`.
- **ENGINEER — SCOPED PASS:** Actual scheduling action delivered via built isolated outbox CLI worker to Assessor, Worker and Company actionable record links; unread/read persisted.
- **CYBERSECURITY — tested-boundary SCOPED PASS:** Unrelated Worker receives none and forged notification ID denied; first run missing isolated worker bundle (ENVIRONMENT), one retry after build passed.
- **REVIEWER — scoped evidence accepted, TECH FULL incomplete:** First-run ENVIRONMENT red and one genuine green retry preserved; no live external email/SMS adapter.
- **Provenance:** isolated exact source `7ff30ea140a5`, original test SHA256 `842f0e457c598c921c6bf17dc3e2896d1e61d95a3dc921301c8060552af0092a`, one actual TAP pass / zero fail / exit0 final; source log SHA256 `81584a057a1c6d33553be072463a71fd37c0da10b555a443e6b0a6da3688e598`.
- **Environmental red and exact one retry:** first source test exit1 (missing generated isolated outbox worker), original log SHA256 `81584a057a1c6d33553be072463a71fd37c0da10b555a443e6b0a6da3688e598`. Ran build script on isolated pinned source (ignored generated bundle SHA256 `be498c424639c5fba727f4c9f988abf43d64c4856fdd79eb564cd7e7dbff173a`), then one exact original test retry TAP 1 PASS/0 FAIL/0 SKIP exit0, retry log SHA256 `b82dd9239a02c6550cd0df599ca1591e176a1953dfe76cbe49b6c37e43c3af8a`. No application source edit; this does not claim real email delivery.

### R76 — M1.05.03 — SCOPED PASS 1/1

**Original scenario:** Read/unread/mark-all and unread badge synchronize across roles.
**Actual case:** `tests/browser/all-role-notification-workflow.browser.test.mjs :: every portal notification bell creates, opens, deep-links and marks persisted notifications read`.
- **ENGINEER — SCOPED PASS:** All six portal notification bells and deep links render real persisted notices and synchronize read/unread/mark-all with 320px separate-browser sessions.
- **CYBERSECURITY — tested-boundary SCOPED PASS:** Copied contexts retain each correct recipient/role unread scope; foreign and unauthorized notification access denied in asserted workflow.
- **REVIEWER — scoped evidence accepted, TECH FULL incomplete:** One six-role notification browser case, not a complete malicious deep-link/adapter campaign.
- **Provenance:** isolated exact source `7ff30ea140a5`, original test SHA256 `07f07dc8f15e94e993d88139491d4410fcd879d15476e0fbd6150f6cf41b4e27`, one actual TAP pass / zero fail / exit0 final; source log SHA256 `73ae71100d6aa0394a00eb1fe101edf3cfa6096805d5050a589267c1b6172321`.

### R77 — M1.05.04 — SCOPED PASS 1/1

**Original scenario:** Outbox retry/idempotency/outage does not roll back underlying business state.
**Actual case:** `tests/platform/outbox-foundation.test.mjs :: M1.05 notification delivery outage does not roll back committed business state, duplicate, or erase retry attempts`.
- **ENGINEER — SCOPED PASS:** Actual PGlite business approval remains committed across delivery outage, retries and later success with retained attempt history.
- **CYBERSECURITY — tested-boundary SCOPED PASS:** Idempotent single job, stale lease denial, no duplicate effect and no rollback of accepted business state.
- **REVIEWER — scoped evidence accepted, TECH FULL incomplete:** Native database worker contract only, not the external delivery provider or complete actor UI.
- **Provenance:** isolated exact source `7ff30ea140a5`, original test SHA256 `dff6a37543a7ca0946a5bea691d5d14555b61f851f7303b847c48b27375b3e63`, one actual TAP pass / zero fail / exit0 final; source log SHA256 `c656f78046fc4513cb3b3e474f87f8a696ba12a528564a2b6e16755b955c9dcd`.

### R78 — M1.06.01 — SCOPED PASS 1/1

**Original scenario:** PDF/PNG/JPEG accepted through scan and exact record binding.
**Actual case:** `tests/browser/m10601-three-format-scan-binding.browser.test.mjs :: M1.06.01 real PDF PNG JPEG Worker uploads scan and bind exact record and version with private previews`.
- **ENGINEER — SCOPED PASS:** Real Worker PDF PNG JPEG uploads scanned successfully, bound to precise qualification record and version, two prior file revisions retained.
- **CYBERSECURITY — tested-boundary SCOPED PASS:** Only owner preview returns exact content 200; anonymous and foreign Worker return 404; detected MIME and distinct safe hashes recorded.
- **REVIEWER — scoped evidence accepted, TECH FULL incomplete:** Local scanner/secure-files browser fixture checked, not the external production scanning service or full upload threat suite.
- **Provenance:** isolated exact source `7ff30ea140a5`, original test SHA256 `70811348b5c7c36301981f484594fbcf607fd02dfde9d1566acd1484145263ad`, one actual TAP pass / zero fail / exit0 final; source log SHA256 `c85e7b231925f52d2f61e8c431019f030c8b17ad651963e977bd64b508684eec`.

## Quality controls and missing requirements

- Complete nine-case run terminal: 8/9 first-run cases PASS; R75 first-run ENVIRONMENT FAILED and single permitted retry PASS => **9/9 final scoped PASS**. Both red and green R75 raw logs and build command preserved; no silent erasure or invented green.
- Exact original Masterplan count 218 and 58 deterministic batch groups unchanged; current app SHA source test files untouched. Original 1611 historic case index and 4975 planned slot register require separate final checks. No TECH_FULLY_VERIFIED award for these nine partial-source checks.
- The three disciplines are performed as AI QA evidence assessments in one session, not claims of three separately employed licensed experts or independently signed reviewer accounts.
- Actual external email/SMS, full live scanner/identity/payments/video/storage adapters; all original positive/negative/retry/receiving-role UI paths, separate independent pentest and staging load/recovery are still open. A scoped test case alone is not end-to-end feature certification.
- Complete private, SHA-verifiable evidence: `/home/ubuntu/work/.hse-qa-tmp/agency-zero-r69-r78/R69-R78-three-discipline-raw-receipts.json` SHA256 `8e6c5246892881d06f3004615092d6ae565b27fc29a821cb309851b378159875`. Runner progress SHA256 `d95a7934f9a221dfab0bd1f0faa98c4335e2e8334175f744d6e7acd9c2063994`. All raw logs, temporary identities and generation details remain off GitHub.

**NEXT R79:** review approved candidate integration of two source fixes, source/build provenance and protected stage restart/rollback; continue untouched M1.06 scan/attachment boundaries and original-batch comprehensive reviews. Keep original TECH FULL numerator at 0/218 until all three discipline attestation gates and adapter/UI/role contracts are evidenced on the common authorized candidate.

**OWNER TESTING READY: NO. PRODUCTION UNCHANGED.**
