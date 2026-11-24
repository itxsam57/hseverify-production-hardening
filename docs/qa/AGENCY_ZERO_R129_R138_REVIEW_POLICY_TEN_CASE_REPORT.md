# ZERO R129–R138 — Evidence review decisions and effective competency policy

**10 distinct original Masterplan scenarios, one exact named test per R batch: 10/10 SCOPED PASS on clean frozen app source SHA `7ff30ea140a5145e5d5ba761f7c7aef24c895269`. TECH FULL remains 0/218, all 58 original groups unresolved.**

Frozen src tree `e01d07918a03b78a76830b52d8ab67d853c96148`, report configuration SHA256 `de17615d0f7638af6dca22fdeeb646a91c567bd65cbed9eab8f1bc3aaec299de`. Chromium in R132/R136/R137/R138, native isolated PGlite in other six. No independent Postgres16 two-connection race in this batch. No application source, shared staging, external provider or production mutation. All earlier unapproved Company source differences in QA stack still subject to strict source-pin CI failure.

## Ten original IDs, three specialist QA disciplines and precise evidence

### R129 — M2.02.02 — SCOPED PASS 1/1

**Original workflow:** Claim/conflict/reassignment/finalization preserve source and history.
**Selected source case:** `tests/platform/evidence-review-queue-runtime.test.mjs :: M2.02 runtime conflict declaration releases an assignment and permanently blocks that verifier`.
- **ENGINEER — SCOPED PASS:** One Verifier declared conflict on assigned source, assignment released and that Verifier permanently blocked from reclaiming exact task.
- **CYBERSECURITY — tested boundaries SCOPED PASS:** Conflict decision and subsequent same-Verifier claim refused; private task/source history retained.
- **REVIEWER — scoped evidence accepted; full certification withheld:** Focused native conflict/reassignment constraint, not complete live UI for initial claim, reassignment and all finalization outcomes.
- **Raw reproducibility:** candidate `7ff30ea140a5`, original test-file SHA256 `9cc9588216bc3c2c40215e94d543d1ffd6bfaa1715d80173029ac9d0c29a0e7f`, private log SHA256 `2148550669c1273914d1baa4501426a52798b6ab07d01fea4419f2b27fe07b19`, exit0, TAP 1 PASS/0 FAIL/0 SKIP.

### R130 — M2.02.03 — SCOPED PASS 1/1

**Original workflow:** Approve/reject/changes/unable/escalate return exact next action to Worker/Company.
**Selected source case:** `tests/platform/evidence-review-queue-runtime.test.mjs :: M2.02 CHANGES_REQUESTED returns the case to the Worker while preserving reviewed-version lineage`.
- **ENGINEER — SCOPED PASS:** Requested changes returned case to original Worker next actor with immutable reviewed-version lineage.
- **CYBERSECURITY — tested boundaries SCOPED PASS:** Exactly reviewed source preserved and worker routing state updated without rewriting prior review.
- **REVIEWER — scoped evidence accepted; full certification withheld:** Single native CHANGES_REQUESTED path only; APPROVED, REJECTED, UNABLE_TO_VERIFY, ESCALATE live Worker/Company receipts not covered by this test.
- **Raw reproducibility:** candidate `7ff30ea140a5`, original test-file SHA256 `9cc9588216bc3c2c40215e94d543d1ffd6bfaa1715d80173029ac9d0c29a0e7f`, private log SHA256 `339155977a42bdce4c736e7a662e1be6e14cd522eeeaffc8f44cb32ad5a28109`, exit0, TAP 1 PASS/0 FAIL/0 SKIP.

### R131 — M2.02.04 — SCOPED PASS 1/1

**Original workflow:** Correction resubmission supersedes stale open task but keeps terminal decisions.
**Selected source case:** `tests/platform/evidence-review-queue-runtime.test.mjs :: M2.02.04 corrected case evidence supersedes assigned stale work but preserves terminal decision history`.
- **ENGINEER — SCOPED PASS:** Corrected evidence superseded stale assigned work but original terminal decisions remained intact.
- **CYBERSECURITY — tested boundaries SCOPED PASS:** Stale version decision prevented and append-only decision history intact in native fixture.
- **REVIEWER — scoped evidence accepted; full certification withheld:** Source-linked corrected-task native workflow; all browser pages, notifications and real storage versions remain open.
- **Raw reproducibility:** candidate `7ff30ea140a5`, original test-file SHA256 `9cc9588216bc3c2c40215e94d543d1ffd6bfaa1715d80173029ac9d0c29a0e7f`, private log SHA256 `fafa0714e800fc585c0be4b4f052fc46086b16ac34df44234f6bbe73913e671e`, exit0, TAP 1 PASS/0 FAIL/0 SKIP.

### R132 — M2.02.05 — SCOPED PASS 1/1

**Original workflow:** Second review/calibration/scope/workload govern sensitive task access.
**Selected source case:** `tests/browser/evidence-review-quality.browser.test.mjs :: Admin quality selection and capacity -> blind first review -> native notification -> independent final review`.
- **ENGINEER — SCOPED PASS:** Actual Admin selected independent second review and set capacity; first Verifier blind review, native notification, independent second Verifier final result, audit and private findings checked.
- **CYBERSECURITY — tested boundaries SCOPED PASS:** First reviewer could not see second task when at capacity; second reviewer saw no first private reasoning; independent review tied to source and role.
- **REVIEWER — scoped evidence accepted; full certification withheld:** Real 3-role Chromium with local PGlite and built outbox worker; full independent human calibration, workload saturation, and provider email remain incomplete.
- **Raw reproducibility:** candidate `7ff30ea140a5`, original test-file SHA256 `4762ae2e98dd5dc75c301d49cda6887e6f9a9ab91dd5b8d00427af1cc7b94b3d`, private log SHA256 `2c3cc21f7a9b5994cf4141543b2a7be386649fb4caacab5c4fb15916e5993dd8`, exit0, TAP 1 PASS/0 FAIL/0 SKIP.

### R133 — M2.03.01 — SCOPED PASS 1/1

**Original workflow:** Create versioned framework and publish policy.
**Selected source case:** `tests/platform/framework-effective-policy-admin-runtime.test.mjs :: M2.03 admin service publishes a real version only from a live fixed-role admin session`.
- **ENGINEER — SCOPED PASS:** Live Admin fixed-role session published a versioned framework via native policy service.
- **CYBERSECURITY — tested boundaries SCOPED PASS:** Role authority bound to authenticated Admin service, publication is controlled.
- **REVIEWER — scoped evidence accepted; full certification withheld:** Native PGlite service case, not actual Admin browser policy form, all publication validation and real PostgreSQL.
- **Raw reproducibility:** candidate `7ff30ea140a5`, original test-file SHA256 `94a2bbcaa44d95896da373b029b42d9b5657487225454cae263f520ed8ab5817`, private log SHA256 `8d64d66c6ea5ab0099161a97ae31ef91805b8a0025ff668b83f87e308794497f`, exit0, TAP 1 PASS/0 FAIL/0 SKIP.

### R134 — M2.03.02 — SCOPED PASS 1/1

**Original workflow:** Weaker company override denied; valid override snapshotted.
**Selected source case:** `tests/platform/framework-effective-policy-runtime.test.mjs :: M2.03 rejects disallowed and weakening overrides and never leaks them across tenants`.
- **ENGINEER — SCOPED PASS:** Disallowed and weakening Company policy overrides refused; a separate tenant did not inherit the invalid override.
- **CYBERSECURITY — tested boundaries SCOPED PASS:** Cannot reduce platform minimum or leak an override across Company tenants.
- **REVIEWER — scoped evidence accepted; full certification withheld:** Focused negative native domain case; valid tightening and exact Company UI/snapshot receiving not in this case.
- **Raw reproducibility:** candidate `7ff30ea140a5`, original test-file SHA256 `2af369b57f609c3df9d4ba834fbd647a699c9bf1b09dc7f7d3bf27b8eca5be96`, private log SHA256 `0fa21162ace7070c783ce59d50cbdebc8a526374fe56c7dcf3bfe01b123f3be1`, exit0, TAP 1 PASS/0 FAIL/0 SKIP.

### R135 — M2.03.03 — SCOPED PASS 1/1

**Original workflow:** Case policy remains pinned after later publication.
**Selected source case:** `tests/platform/framework-effective-policy-runtime.test.mjs :: M2.03 concurrent snapshot pinning creates one immutable snapshot and later policy rows cannot rewrite it`.
- **ENGINEER — SCOPED PASS:** Concurrent policy snapshot pins resolved to one immutable case snapshot; later published policy rows could not rewrite its rules.
- **CYBERSECURITY — tested boundaries SCOPED PASS:** Snapshot idempotency and policy lineage preserved despite later source publication.
- **REVIEWER — scoped evidence accepted; full certification withheld:** PGlite fixture concurrency rather than two independently authenticated PostgreSQL sessions; complete live assessment consumer display remains open.
- **Raw reproducibility:** candidate `7ff30ea140a5`, original test-file SHA256 `2af369b57f609c3df9d4ba834fbd647a699c9bf1b09dc7f7d3bf27b8eca5be96`, private log SHA256 `2032093151563b6fb1a85c40f814de1ae9114d20a80ff965373002244855cb4f`, exit0, TAP 1 PASS/0 FAIL/0 SKIP.

### R136 — M2.03.04 — SCOPED PASS 1/1

**Original workflow:** Waiting period, attempt limits, jurisdiction and risk eligibility.
**Selected source case:** `tests/browser/assessment-eligibility-policy.browser.test.mjs :: Actual Worker waiting/date, forged apply and Company submit denial become later eligible under pinned policy`.
- **ENGINEER — SCOPED PASS:** Real Worker and Company browser waiting/date denial, forged early submission denied; advancing clock unlocks Worker application and pinned assessment case.
- **CYBERSECURITY — tested boundaries SCOPED PASS:** Server refused bypass for Worker or Company, later genuine eligibility satisfied policy and current workflow.
- **REVIEWER — scoped evidence accepted; full certification withheld:** Waiting/date branch only: attempt limits, jurisdiction and risk policy inputs not exhaustively verified in this exact case.
- **Raw reproducibility:** candidate `7ff30ea140a5`, original test-file SHA256 `b08963a31f18de336a1a7fc197631b615395026fbab7415d3f87904d83be9157`, private log SHA256 `7ae05d2294f7c5cfd95ec97c315c674aec720dbe80f21954fc4d67348ca88e68`, exit0, TAP 1 PASS/0 FAIL/0 SKIP.

### R137 — M2.03.05 — SCOPED PASS 1/1

**Original workflow:** Accommodation changes delivery without lowering score standards.
**Selected source case:** `tests/browser/accommodation-delivery.browser.test.mjs :: approved accessible Worker assessment retains original pass standard across browser submission`.
- **ENGINEER — SCOPED PASS:** Approved accessible Worker assessment submitted through Chromium while retaining original pass threshold.
- **CYBERSECURITY — tested boundaries SCOPED PASS:** Delivery accommodation did not lower the existing objective competency scoring standard in selected source test.
- **REVIEWER — scoped evidence accepted; full certification withheld:** One approved accessibility delivery/browser case; other language, human support, break and tenant misuse combinations remain open.
- **Raw reproducibility:** candidate `7ff30ea140a5`, original test-file SHA256 `7b40fc4aa951df271e0fbcef68833cf664428154ca2e08103896d2325c215102`, private log SHA256 `bc110a4cb223eacff92f5cc49a0c6617aaf211584493c60115c5e1e3daa318b5`, exit0, TAP 1 PASS/0 FAIL/0 SKIP.

### R138 — M2.03.06 — SCOPED PASS 1/1

**Original workflow:** Credential validity and renewal derive from pinned rule.
**Selected source case:** `tests/browser/credential-validity.browser.test.mjs :: Browser, public API and actual PDF show the decision-pinned expiry and preserved live lifecycle`.
- **ENGINEER — SCOPED PASS:** Real browser, public Verify API and rendered actual PDF reflected decision-pinned credential expiry and historical lifecycle.
- **CYBERSECURITY — tested boundaries SCOPED PASS:** Issued expiry remained bound to original signed decision across public/PDF projections, not browser-editable.
- **REVIEWER — scoped evidence accepted; full certification withheld:** Single browser validity path; credential renewal, multiple policy changes after expiry and live issuer signature validation not all verified.
- **Raw reproducibility:** candidate `7ff30ea140a5`, original test-file SHA256 `6dbae1efa6572c09e17b762e803bbe3c80161c8ef4d18bbae41e4f4d5cfde157`, private log SHA256 `12ffb33c60984ef50a0468386b6e853f68dae25cbc38b7c9f23e31d2e3af2438`, exit0, TAP 1 PASS/0 FAIL/0 SKIP.

## Exact limitations, reconciliation and handover

- **Raw three-discipline evidence** private `/home/ubuntu/work/.hse-qa-tmp/agency-zero-r129-r138/R129-R138-exact-three-discipline-raw-receipts.json` SHA256 `9b9943506df2bd460497aa1a7d4caffe045a03a55253a8ee2533a01b1e6cca92`; per-case raw logs in same private 0700 vault and progress file SHA256 `afad7282207227320415b4c7d4dc8e39af9cce31fa85ab066493b5d39ca6cb7d`. No secrets or raw private data committed.
- **Do not promote narrowly passing cases to TECH FULL:** R129 conflict but not full claim/reassignment/finalization browser; R130 changes requested but not every approve/reject/unable/escalate recipient; R131 corrected version native only; R132 three-role quality browser but no complete calibration load/independent pentest; R133 native Admin policy publication but no policy form; R134 invalid override only; R135 PGlite case-pin race, not genuine PostgreSQL; R136 waiting/date only (risk/jurisdiction/attempt cap open); R137 one scoring accommodation; R138 expiry browser/API/PDF but actual renewal/live issuer certification remains unverified.
- **No external agency signature asserted:** ENGINEER/CYBERSECURITY/REVIEWER are three structured AI QA assessment perspectives, not a substitute for independent signed human expert audits or full attack coverage. All-role negative/retry/mobile/a11y, live adapter contracts, realistic load/penetration, current stage authorization, safe rollback and final exact candidate release checks remain open.
- **Integrity gate remains NO-GO:** Two unapproved R36/R40 Company app file differences from official 7ff pin in inherited QA stack; source SHA check must remain fail-closed. Stage metadata/provenance restart safety, signed source-build chain, retained verified backup and live email/SMS/storage/scanner/identity/video/payment providers remain separate unresolved gates. Stage no mutations and production unchanged.
- **Inventory unchanged:** original 218 IDs, 58 deterministic grouping batches, 1,611 historical source tests, 4,975 planned check slots. No original TECH FULL credit minted from scoped selected cases.

**NEXT R139:** M2.04.01–.06 assessment question authoring/review/publish/retire/import/capacity, then M2.05 blueprint and randomized forms. Do not repeat earlier cases without new dimension or approved new source SHA.

**TECH FULL 0/218 | OWNER TESTING READY NO | PRODUCTION UNCHANGED.**
