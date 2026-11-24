# ZERO R139–R158 — Twenty original question bank, form, funding and precheck source cases

**20 unique immutable original IDs; four related groups of exactly five R batches, one named source test/workflow per R batch. 20/20 scoped source PASS, 0 red/unproven. Original TECH FULL remains 0/218.**

Exact official frozen application SHA `7ff30ea140a5145e5d5ba761f7c7aef24c895269`, src Git tree `e01d07918a03b78a76830b52d8ab67d853c96148`. Configuration SHA256 `cc49f278c17a854ef60bb89ac732e9f72eae5e05e804215ce6214da50129fe68`. Tests used synthetic isolated PGlite and some real local Chromium, not protected shared staging. No app tracked source, stage or production modifications. All live external adapters and actual physical proctor media remain unverified.

## Exact source cases and three specialist reviews

### Related five-case batch R139–R143 (R139, R140, R141, R142, R143)

**R139 — M2.04.01: SCOPED PASS** — MCQ and written authoring validate answers/rubrics

Test: `tests/platform/question-bank-runtime.test.mjs :: M2.04 rejects malformed MCQ, boolean, numeric and written question shapes`.
- ENGINEER (SCOPED_PASS): Authoring shape validation rejects malformed MCQ/boolean/numeric/written input.
- CYBERSECURITY (TESTED_BOUNDARY_SCOPED_PASS): Server-side validation boundary covered for malformed shapes.
- REVIEWER (SCOPED_EVIDENCE_ACCEPTED_NOT_TECH_FULL): Live Admin/Reviewer browser entry, all question types and hostile imports incomplete.
- Evidence: file SHA256 `9ecf447d809ad21bdfd60ef0221b440297647f216393e3325e4dee65be56f65f`, private raw log SHA256 `576f16d78f713d33643e2fbd400ae053e60f8b6fc12b3284ca601b5bf1c41082`; actual TAP 1 pass / 0 fail / 0 skipped, exit 0.

**R140 — M2.04.02: SCOPED PASS** — Draft/review/changes/approval/publication workflow

Test: `tests/platform/question-bank-runtime.test.mjs :: Question independent approval retains old live publication through changes, CAS races and terminal archival`.
- ENGINEER (SCOPED_PASS): Independent publication decision preserves earlier live version through changes requested, compare-and-swap races, and terminal archival.
- CYBERSECURITY (TESTED_BOUNDARY_SCOPED_PASS): Independent review/author conflict path tested, immutable older publication retained.
- REVIEWER (SCOPED_EVIDENCE_ACCEPTED_NOT_TECH_FULL): All admin-reviewer dashboard clicks, roles and edits unverified in this one source test.
- Evidence: file SHA256 `9ecf447d809ad21bdfd60ef0221b440297647f216393e3325e4dee65be56f65f`, private raw log SHA256 `f99734de836a64fdbe37e93e317fafba4f6167cd8dcf76a26294c32f00d0b865`; actual TAP 1 pass / 0 fail / 0 skipped, exit 0.

**R141 — M2.04.03: SCOPED PASS** — Published revision preserves exact old question and rubric

Test: `tests/platform/question-bank-runtime.test.mjs :: M2.04 eight-way stale revision race has exactly one winner and preserves every version row`.
- ENGINEER (SCOPED_PASS): Eight simultaneous stale revisions resolve to one winning question version without erasing prior rows.
- CYBERSECURITY (TESTED_BOUNDARY_SCOPED_PASS): Single-winner revision race with append-only version lineage.
- REVIEWER (SCOPED_EVIDENCE_ACCEPTED_NOT_TECH_FULL): Real two-Admin PostgreSQL16 sessions and browser version-selection remain open.
- Evidence: file SHA256 `9ecf447d809ad21bdfd60ef0221b440297647f216393e3325e4dee65be56f65f`, private raw log SHA256 `9f8929b6142e5096a2c50680078dafe4319b81c340f09e4732d3920289bd266b`; actual TAP 1 pass / 0 fail / 0 skipped, exit 0.

**R142 — M2.04.04: SCOPED PASS** — Pause/retire/archive excludes future forms, preserves prior attempts

Test: `tests/platform/question-approval-migration.test.mjs :: Archiving newer draft restores published authoring without resurrecting retired history`.
- ENGINEER (SCOPED_PASS): Archiving newer draft restores earlier publication without bringing retired questions back.
- CYBERSECURITY (TESTED_BOUNDARY_SCOPED_PASS): Historical retired state not resurrected on archival.
- REVIEWER (SCOPED_EVIDENCE_ACCEPTED_NOT_TECH_FULL): Future-form selection and actual historic attempts not checked in this one migration test.
- Evidence: file SHA256 `80e5bcc147f64b2f9b75d2c1bf2a6c64540a18cf7d20c52c8fc6842984b5b02d`, private raw log SHA256 `b4793c176793c8d3ffef250eca58d7ff498a6013f40a335aea724f9d168a835f`; actual TAP 1 pass / 0 fail / 0 skipped, exit 0.

**R143 — M2.04.05: SCOPED PASS** — Bulk import reports invalid rows without partial corruption

Test: `tests/platform/question-bank-runtime.test.mjs :: M2.04 bulk draft import is all-or-nothing, reports the failing row and preserves independent approval`.
- ENGINEER (SCOPED_PASS): Bulk draft import rejects a bad row atomically and preserves independent approval.
- CYBERSECURITY (TESTED_BOUNDARY_SCOPED_PASS): Partial-import state corruption refused for selected failing-row fixture.
- REVIEWER (SCOPED_EVIDENCE_ACCEPTED_NOT_TECH_FULL): Actual Admin bulk-upload UI and multiple encoding/CSV injection/file-size dimensions not covered.
- Evidence: file SHA256 `9ecf447d809ad21bdfd60ef0221b440297647f216393e3325e4dee65be56f65f`, private raw log SHA256 `d8925c99c5a31888a3e6a1e17b8ffe9d8772f72826c85d07e31672f408ae6115`; actual TAP 1 pass / 0 fail / 0 skipped, exit 0.

### Related five-case batch R144–R148 (R144, R145, R146, R147, R148)

**R144 — M2.04.06: SCOPED PASS** — Capacity metrics update after publication/exposure

Test: `tests/platform/question-bank-runtime.test.mjs :: M2.04 capacity metrics reflect publication, Worker reservations and retirement without leaking answers`.
- ENGINEER (SCOPED_PASS): Question capacity recalculates after publication, Worker reservations, and retirement.
- CYBERSECURITY (TESTED_BOUNDARY_SCOPED_PASS): Selected capacity figures exclude hidden answer material.
- REVIEWER (SCOPED_EVIDENCE_ACCEPTED_NOT_TECH_FULL): Heavy concurrency and front-end metrics on all tenants not certified.
- Evidence: file SHA256 `9ecf447d809ad21bdfd60ef0221b440297647f216393e3325e4dee65be56f65f`, private raw log SHA256 `9cc7ca09cf8461972f920b1f2bfd36ccd452a523303ab2bfc920e06582b38264`; actual TAP 1 pass / 0 fail / 0 skipped, exit 0.

**R145 — M2.05.01: SCOPED PASS** — Unseen randomized blueprint-equivalent MCQ-only, written-only and combined forms

Test: `tests/platform/randomized-assessment-form-runtime.test.mjs :: M2.05.01 M2.05.02 M2.05.04 canonical MCQ-only written-only mixed real generation, permanent exposure and exhaustion`.
- ENGINEER (SCOPED_PASS): Actual canonical MCQ-only, written-only, combined generation and exposure/exhaustion native fixture.
- CYBERSECURITY (TESTED_BOUNDARY_SCOPED_PASS): Pinned original blueprint and exposure ownership in selected generation path.
- REVIEWER (SCOPED_EVIDENCE_ACCEPTED_NOT_TECH_FULL): Real Worker browser variants, proctor integration and live administration not proved.
- Evidence: file SHA256 `5fcc0f575d4dc62fd9bde96f14f8cdbd49fddc0c346d33d7c3972ea63cc32e46`, private raw log SHA256 `87b34b1e7d2cd870e8b71a58b42db3adf46012a4eb99b8e3b6a8242755ac3781`; actual TAP 1 pass / 0 fail / 0 skipped, exit 0.

**R146 — M2.05.02: SCOPED PASS** — Permanent non-repetition across exit, device change, retake and company change

Test: `tests/platform/randomized-assessment-form-runtime.test.mjs :: M2.05 never repeats a stable question for the same Worker, even after question revision`.
- ENGINEER (SCOPED_PASS): A Worker never receives the same stable question after its question revision.
- CYBERSECURITY (TESTED_BOUNDARY_SCOPED_PASS): Stable question lineage excluded for the Worker.
- REVIEWER (SCOPED_EVIDENCE_ACCEPTED_NOT_TECH_FULL): Device changes, Company switches and full exposure-family variants not independently checked by this exact case.
- Evidence: file SHA256 `5fcc0f575d4dc62fd9bde96f14f8cdbd49fddc0c346d33d7c3972ea63cc32e46`, private raw log SHA256 `ea4211d8c04f0328aacf1a510fc70aa2f1d51a79134c327383bee6ecbe77bb1d`; actual TAP 1 pass / 0 fail / 0 skipped, exit 0.

**R147 — M2.05.03: SCOPED PASS** — Exposure families and displayed unanswered questions excluded

Test: `tests/browser/masterplan-worker-exposure-family-e2e.browser.test.mjs :: M2.05.03 real Worker displays an unanswered question, emergency exits, and another device cannot obtain its Exposure Family`.
- ENGINEER (SCOPED_PASS): Real Worker Chromium question exposure survives Emergency Exit, and another device cannot reuse the exposed family.
- CYBERSECURITY (TESTED_BOUNDARY_SCOPED_PASS): Unanswered viewed question and alternate-device reuse boundary tested.
- REVIEWER (SCOPED_EVIDENCE_ACCEPTED_NOT_TECH_FULL): Multiple Companies, offline devices and complete return/resume all-permutations unverified.
- Evidence: file SHA256 `6b2a096b27bc424ac3c49aa46088608ff491f8ecbc37fa980b72f06633984e4a`, private raw log SHA256 `0f1785856822d4867a8db7f525d29cba081b1635e01ab022fab8cbbf0d269f0c`; actual TAP 1 pass / 0 fail / 0 skipped, exit 0.

**R148 — M2.05.04: SCOPED PASS** — Insufficient unseen capacity blocks cleanly without entitlement corruption

Test: `tests/platform/randomized-assessment-form-runtime.test.mjs :: M2.05 insufficient unseen pool fails closed with no partial form`.
- ENGINEER (SCOPED_PASS): Unseen question pool exhaustion denies generation without partial form.
- CYBERSECURITY (TESTED_BOUNDARY_SCOPED_PASS): Capacity exhaustion does not write a partial generated form in selected native case.
- REVIEWER (SCOPED_EVIDENCE_ACCEPTED_NOT_TECH_FULL): Credit/refund/entitlement accounting and friendly Worker browser error still need full evidence.
- Evidence: file SHA256 `5fcc0f575d4dc62fd9bde96f14f8cdbd49fddc0c346d33d7c3972ea63cc32e46`, private raw log SHA256 `eab338ba55e6479deb3db55060fab84c7338346ddfcc9d7dd99a9ca442ca765e`; actual TAP 1 pass / 0 fail / 0 skipped, exit 0.

### Related five-case batch R149–R153 (R149, R150, R151, R152, R153)

**R149 — M2.05.05: SCOPED PASS** — Option order and question versions pinned across refresh

Test: `tests/platform/assessment-form-delivery.test.mjs :: M2.05 form delivery returns exact pinned question versions and no hidden scoring material`.
- ENGINEER (SCOPED_PASS): Form delivery returns exact published question versions without answer key/rubric in selected service fixture.
- CYBERSECURITY (TESTED_BOUNDARY_SCOPED_PASS): Pinned version and hidden scoring projection enforced for selected form.
- REVIEWER (SCOPED_EVIDENCE_ACCEPTED_NOT_TECH_FULL): Shuffled option order and refresh stability not specifically attested in this test.
- Evidence: file SHA256 `006f2b8f0c73916bd7000d76e8405c4ca8bcc095814a80a4d00d3a74143061aa`, private raw log SHA256 `77b72b282667bcd13f9be584476f9f044d336b6fb3c47eb4c4138faeeffc14e3`; actual TAP 1 pass / 0 fail / 0 skipped, exit 0.

**R150 — M2.05.06: SCOPED PASS** — Future questions, answer keys and rubrics absent from candidate payload

Test: `tests/platform/question-bank-runtime.test.mjs :: M2.04 delivery projection exposes no hidden answer or scoring material`.
- ENGINEER (SCOPED_PASS): Question Bank delivery projection omits hidden answer and rubric/scoring authority.
- CYBERSECURITY (TESTED_BOUNDARY_SCOPED_PASS): Selected native candidate projection leak protection tested.
- REVIEWER (SCOPED_EVIDENCE_ACCEPTED_NOT_TECH_FULL): Full future-question payload, complete HTTP responses and browser network trace/pentest unverified.
- Evidence: file SHA256 `9ecf447d809ad21bdfd60ef0221b440297647f216393e3325e4dee65be56f65f`, private raw log SHA256 `d7a527164f2e589d4af4a975c150dbac09a2967cb39862f29136b9aedb3debba`; actual TAP 1 pass / 0 fail / 0 skipped, exit 0.

**R151 — M2.06.01: SCOPED PASS** — Verified/unverified qualification eligibility and unavailable reasons

Test: `tests/platform/assessment-catalogue-eligibility-runtime.test.mjs :: M2.06 minimum one requires exact-current submitted APPROVED qualification lineage`.
- ENGINEER (SCOPED_PASS): Only exact-current submitted APPROVED qualification lineage satisfies minimum-one eligibility.
- CYBERSECURITY (TESTED_BOUNDARY_SCOPED_PASS): Unverified/rejected/foreign qualification lineage fail closed in selected native service.
- REVIEWER (SCOPED_EVIDENCE_ACCEPTED_NOT_TECH_FULL): Full Worker/Company browser availability descriptions and all optional trade/experience branches not proved.
- Evidence: file SHA256 `37ab3e0e2efc9772c0a50e1f3674c6a579e20a100841c747cadf87c850873968`, private raw log SHA256 `817d029f1062c242d7462bdca9aaa1c82a277b277f57db2ed3ef6dc9a32ddb64`; actual TAP 1 pass / 0 fail / 0 skipped, exit 0.

**R152 — M2.06.02: SCOPED PASS** — Self sandbox payment to funded case, safe duplicate confirmation

Test: `tests/browser/assessment-eligibility-policy.browser.test.mjs :: Configured qualification gates Worker and Company until original Verifier approval, then self-payment pins and starts the exact case`.
- ENGINEER (SCOPED_PASS): Actual Worker and Company browser qualification gate waits for Verifier approval, then sandbox self-pay pins/starts owned case.
- CYBERSECURITY (TESTED_BOUNDARY_SCOPED_PASS): Genuine approved evidence source required before self-funded eligibility.
- REVIEWER (SCOPED_EVIDENCE_ACCEPTED_NOT_TECH_FULL): Actual payment processor callback and all duplicate/chargeback/retry events not proven.
- Evidence: file SHA256 `b08963a31f18de336a1a7fc197631b615395026fbab7415d3f87904d83be9157`, private raw log SHA256 `abed81c4fdc3e42c173355aa7c7ca7c557be6357f6a8671f2d495a41495af203`; actual TAP 1 pass / 0 fail / 0 skipped, exit 0.

**R153 — M2.06.03: SCOPED PASS** — Company request approved, rejected and retried/self-funded

Test: `tests/platform/assessment-funding-notification-runtime.test.mjs :: Real Company approval delivers the owned Worker assessment next action and replay cannot reserve credits twice`.
- ENGINEER (SCOPED_PASS): Company funding approval gives the owned Worker the next assessment action; replay cannot reserve a purchased credit twice.
- CYBERSECURITY (TESTED_BOUNDARY_SCOPED_PASS): Funding idempotency and own Worker next action tested in native service.
- REVIEWER (SCOPED_EVIDENCE_ACCEPTED_NOT_TECH_FULL): Worker rejection and self-funded recovery UI, genuine payment provider and real PG16 race not certified.
- Evidence: file SHA256 `325648c27efe9ffa26909df71701ac55a43763549246ff597f1febb89c2f18bb`, private raw log SHA256 `e7d06832ee6b557b77179d15853d595aa9338d5757efdd75bbc66c68972f0d41`; actual TAP 1 pass / 0 fail / 0 skipped, exit 0.

### Related five-case batch R154–R158 (R154, R155, R156, R157, R158)

**R154 — M2.06.04: SCOPED PASS** — Insufficient credits to checkout/capture to approved assessment

Test: `tests/browser/funding-revoked-link-e2e.browser.test.mjs :: M2.06 Company zero credits rejects funding, then genuine sandbox checkout allows owned Worker case`.
- ENGINEER (SCOPED_PASS): Real Company browser rejects zero-credit approval, then synthetic sandbox checkout funds one owned Worker case.
- CYBERSECURITY (TESTED_BOUNDARY_SCOPED_PASS): No-credit error and sandbox checkout transition checked.
- REVIEWER (SCOPED_EVIDENCE_ACCEPTED_NOT_TECH_FULL): PSP live/sandbox certified provider callbacks, refunds and cross-account race not certified.
- Evidence: file SHA256 `a77d5301949ee6bae4f1fe368ef919862cfa0c0ea1a35d79f2063475c5520c6f`, private raw log SHA256 `33087d039de5adea881d800c7c379e8a5cb3641a82e70a36fe0c30d91e2e2f47`; actual TAP 1 pass / 0 fail / 0 skipped, exit 0.

**R155 — M2.06.05: SCOPED PASS** — Link revoked before approval prevents funding and case creation

Test: `tests/browser/funding-revoked-link-e2e.browser.test.mjs :: M2.06 revoked Company–Worker relationship cannot approve a pending funding request or create a case`.
- ENGINEER (SCOPED_PASS): Real browser shows revoked Company–Worker link prevents pending funding approval/case creation.
- CYBERSECURITY (TESTED_BOUNDARY_SCOPED_PASS): Stale-link approval attempt fails closed after revocation.
- REVIEWER (SCOPED_EVIDENCE_ACCEPTED_NOT_TECH_FULL): Other tenants/roles/retry after re-link, real payment and notification recovery still open.
- Evidence: file SHA256 `a77d5301949ee6bae4f1fe368ef919862cfa0c0ea1a35d79f2063475c5520c6f`, private raw log SHA256 `7615d6644a1a87f0bde26276ab133a3cd99c24269d9275ee8986b2bff8de6b3f`; actual TAP 1 pass / 0 fail / 0 skipped, exit 0.

**R156 — M2.06.06: SCOPED PASS** — Waiting/attempt limits/current credential/reassessment affect availability

Test: `tests/platform/assessment-eligibility-context-runtime.test.mjs :: An actual terminal producer between offering read and Worker application transaction cannot bypass the published attempt limit`.
- ENGINEER (SCOPED_PASS): Attempt-limit terminal change between read and apply cannot bypass published eligibility.
- CYBERSECURITY (TESTED_BOUNDARY_SCOPED_PASS): Stale offered eligibility fails closed after authoritative terminal outcome.
- REVIEWER (SCOPED_EVIDENCE_ACCEPTED_NOT_TECH_FULL): Waiting/current-credential/reassessment and jurisdiction permutations not all covered in selected test.
- Evidence: file SHA256 `bd8f4d9a8a54835227b35cd16bf567e306671351d63dccf2875ad0d79dfaedb4`, private raw log SHA256 `1c7a893ef8dd6dd0efc3f108d0957f864b09f91bd9f55e5e9c28ec2dc0ac36cb`; actual TAP 1 pass / 0 fail / 0 skipped, exit 0.

**R157 — M2.06.07: SCOPED PASS** — Fresh reapplication after terminal case preserves earlier records

Test: `tests/browser/worker-terminal-reapplication.browser.test.mjs :: M2.06 terminal Worker case permits new application while retaining complete original history`.
- ENGINEER (SCOPED_PASS): Real Worker terminal case allows fresh application and preserves original case history.
- CYBERSECURITY (TESTED_BOUNDARY_SCOPED_PASS): New application cannot erase earlier terminal source rows.
- REVIEWER (SCOPED_EVIDENCE_ACCEPTED_NOT_TECH_FULL): All distinct rejected/reassessment/appeal end states and real payment refund/role flows remain open.
- Evidence: file SHA256 `a0a4512ef2a0da2be4454c1aeefbf062c626cd84b9869f12404bc6780416a8f4`, private raw log SHA256 `8ca0f52a7e72a86fa066956dac1b09dc494467474b50462a426c0c66abf4f8a7`; actual TAP 1 pass / 0 fail / 0 skipped, exit 0.

**R158 — M2.07.01: SCOPED PASS** — Browser/device/media/consent prechecks deny or allow truthfully

Test: `tests/platform/assessment-attempt-action-boundary.test.mjs :: M2.07 start action routes through precheck and only the completed precheck may create a bound owned attempt`.
- ENGINEER (SCOPED_PASS): Static review confirms Worker start action redirects through precheck and requires completed precheck context.
- CYBERSECURITY (TESTED_BOUNDARY_SCOPED_PASS): Source code boundary routes owner check/precheck before creating attempt.
- REVIEWER (SCOPED_EVIDENCE_ACCEPTED_NOT_TECH_FULL): ONLY static source-pattern evidence: NO physical camera/mic/screen, consent or device support, real browser permissions, denial/retry or adapter verification.
- Evidence: file SHA256 `1678d7a673c8f178e2955e3c59e300a37685a648e4653ca06ba1ad2f64b7863f`, private raw log SHA256 `f0dcda28f00a4bbb9f682e7445cf6d7f4b08d06f0589d529b2a6aab9a429b513`; actual TAP 1 pass / 0 fail / 0 skipped, exit 0.

## Technical accountability and protected release status

- Per-case private raw logs, exact commands, source-file SHA hashes, config fingerprint and three ENGINEER/CYBERSECURITY/REVIEWER specialist perspectives: `/home/ubuntu/work/.hse-qa-tmp/agency-zero-r139-r158/R139-R158-three-discipline-private-receipts.json` SHA256 `f06dfbc2d9c63d03d363510e5686d6907a2296b06472500fd41bfc315b4d41f2`. Complete progress SHA256 `a2f020d0d98893b6406e67f1a8252ba1fb5ac230d72f20e484028e0969edb4df`. Runtime compile-only preflight SHA256 `d3f2fd817944ba15103853dc47bb285445e2f0cf004aecb895e1a6dbdf965226`. No private data/keys committed.
- **Do not misread R158:** a source-pattern precheck/start-route test does not verify real physical camera, microphone or screen-sharing controls, browser permissions, actual device problems or consent. The broader M2.07.01 Masterplan remains entirely open for those parts.
- **Do not misread R149:** pinned published question versions and hiding scoring content were tested but option-order stability across refresh was not independently established in that case.
- **Do not misread R152/R154:** genuine PGlite sandbox checkout simulations are not live processor acceptance and are not proof of real charge, webhook, retry, duplicate/refund handling. R153 native funding is not a real independently concurrent PG16 credit reservation.
- Three specialist assessments are reasoned perspectives within this AI QA, **not three separately signed professional auditors**. Complete six-role browser actions, negative/retry/cancel/permission, code quality, manual penetration, load, independently signed adapter checks and validated rollback remain pending. FULL requires OWNER TESTING READY technical breadth on an approved identical candidate; no full award is made here.
- Original 218 scenario catalog and 58 deterministic batches, 1,611 historic sourced cases and 4,975 planned dimension slots remain immutable. Passing the selected twenty tests does not certify entire scenarios or release.
- **NO-GO:** moving QA branch inherits two R36/R40 unapproved Company source changes relative to official frozen7ff app; official GitHub CI source-pin protection expected red, do not bypass/repin without reviewed integration and affected revalidation. Stage pinned7ff HTTPS200/private PG16/outbox running, but signed build provenance, safe stage restart and verified restore snapshot still open. Production untouched.

**NEXT R159:** M2.07.02–.07 strict progression, controlled/section review, expiry, emergency exit and actual Worker written completion; then M2.08 recovery/resume source tests.**

**TECH FULL 0/218 | OWNER TESTING READY NO | PRODUCTION UNCHANGED.**
