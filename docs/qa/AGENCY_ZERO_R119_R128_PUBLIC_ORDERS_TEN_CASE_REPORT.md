# ZERO R119–R128 — Public rate-limit, Company Assurance Orders, funding and review intake

**Ten distinct original IDs, exactly one original test case per R batch, 10/10 first-run SCOPED PASS. TECH FULL remains 0/218; original 58 related batch groups remain open.**

Official frozen application source SHA `7ff30ea140a5145e5d5ba761f7c7aef24c895269`; src Git tree `e01d07918a03b78a76830b52d8ab67d853c96148`. Original source checkout was clean and independent of moving QA stack with two inherited unapproved Company app changes. No production/protected staging changes.

Configuration fingerprint SHA256 `6bfbabde81712084374abaf2a0408d90eff530357f8d9180b3a02d94c4a264c2`. Real Chromium in R122 and R124; eight selected other tests use synthetic local PGlite/native database and notification-projector fixtures. **No independently isolated PostgreSQL16 race ran in this round**; R123 funded-credit concurrency therefore does not establish a real-PostgreSQL or production payment contract.

## Ten distinct source-tested scenario checkpoints

### R119 — M1.12.05 — SCOPED PASS 1/1

**Masterplan workflow:** Abuse/rate limit and expired signed preview deny safely.
**Exact executed test:** `tests/platform/public-verification-rate-limit.test.mjs :: M1.12 atomic public rate limits count every concurrent request and isolate actions/buckets`.
- **ENGINEER — SCOPED PASS:** Atomic native database rate-limit counters handled simultaneous public lookup traffic, isolated action buckets, and refused exceeded quotas.
- **CYBERSECURITY — tested-boundary SCOPED PASS:** Concurrent requests counted without leaking eligible public-lookup identity, separate buckets enforced.
- **REVIEWER — scoped evidence accepted, TECH FULL withheld:** Only one focused native rate-limit case executed; expired signed object previews were NOT exercised in this round, nor whole public browser abuse/cookie/proxy pentest.
- **Actual evidence:** SHA `7ff30ea140a5`, test source SHA256 `9314f8af54dbb8d78cc053e5c5e986947e5098c425e05382c66294139d5befe3`, private raw log SHA256 `7ccb2114c1e4a1896db6deb0af3498e263c6cbaa96198edcb0638c7d224862d7`, TAP 1 PASS / 0 FAIL / 0 skipped, exit0.

### R120 — M2.01.01 — SCOPED PASS 1/1

**Masterplan workflow:** Draft save/edit, add linked Workers, validate and submit.
**Exact executed test:** `tests/platform/assurance-order-case-runtime.test.mjs :: M2.01 real runtime creates one durable Assurance Case and Action Centre obligation per Worker`.
- **ENGINEER — SCOPED PASS:** Native Assurance Order service built a durable order and one Case/Action Centre obligation per eligible Worker.
- **CYBERSECURITY — tested-boundary SCOPED PASS:** Data-source binding and case/action cardinality asserted; service persistence under synthetic PGlite.
- **REVIEWER — scoped evidence accepted, TECH FULL withheld:** No fresh browser draft field save, edit, permission denial and actual PostgreSQL16 multi-actor handoff in this one case.
- **Actual evidence:** SHA `7ff30ea140a5`, test source SHA256 `8a6881fd49cc2bdbf65bce081711d4aea51eaf205755ffcff7462ac370999944`, private raw log SHA256 `266c70050224fd5150c35d46a67ac89ec6e84290a67686703464f91b38307cd4`, TAP 1 PASS / 0 FAIL / 0 skipped, exit0.

### R121 — M2.01.02 — SCOPED PASS 1/1

**Masterplan workflow:** Invalid/unlinked/ineligible Worker and missing funding explained.
**Exact executed test:** `tests/platform/assurance-order-case-runtime.test.mjs :: M2.01 repeated READY validation is idempotent but still rejects subsequently revoked Worker links`.
- **ENGINEER — SCOPED PASS:** Repeated READY validation idempotent until Worker relation revoked; subsequent validation failed safe with prior history preserved.
- **CYBERSECURITY — tested-boundary SCOPED PASS:** Revoked Worker linking denied without duplicate changes; dependent eligibility limit enforced in native service.
- **REVIEWER — scoped evidence accepted, TECH FULL withheld:** Focused native READY policy only; funding missing/invalid/ineligible variants and UI explanations not covered fully.
- **Actual evidence:** SHA `7ff30ea140a5`, test source SHA256 `8a6881fd49cc2bdbf65bce081711d4aea51eaf205755ffcff7462ac370999944`, private raw log SHA256 `a211d23989593247d3ec5bcfcbfdd3778ab7304bb4845fb167ae34b8645584b2`, TAP 1 PASS / 0 FAIL / 0 skipped, exit0.

### R122 — M2.01.03 — SCOPED PASS 1/1

**Masterplan workflow:** Multi-worker cases created once with correct scope/site/deadline.
**Exact executed test:** `tests/browser/m2-01-multiworker-submit.browser.test.mjs :: M2.01 actual two Worker cases keep scope/site/deadline and stale second submit cannot duplicate cases`.
- **ENGINEER — SCOPED PASS:** Real Chromium Company edited saved draft, linked two Workers, submitted one order, preserved both Worker Cases and exact scope/site/department/deadline/interview requirements through cold reload.
- **CYBERSECURITY — tested-boundary SCOPED PASS:** Stale second browser tab cannot submit duplicate; single order event, two case events and no scope reassignment; immutable case/action IDs verified.
- **REVIEWER — scoped evidence accepted, TECH FULL withheld:** Real Company browser/DB with synthetic tenant; actual durable stage PostgreSQL and every independent Worker/assessor recipient not fully verified.
- **Actual evidence:** SHA `7ff30ea140a5`, test source SHA256 `d86125deb86291d5bef84416af834fb85549c0bc8eb467dc08fbcc1d1ff46c79`, private raw log SHA256 `466d1748623d7e76a3d8a6d2fda85ce0326794d39f673eab4eac389a789f636c`, TAP 1 PASS / 0 FAIL / 0 skipped, exit0.

### R123 — M2.01.04 — SCOPED PASS 1/1

**Masterplan workflow:** Duplicate submission and competing credit reservations stay idempotent.
**Exact executed test:** `tests/platform/assessment-funding-notification-runtime.test.mjs :: M2.01.04 competing funded Worker approvals never overreserve one purchased Company credit`.
- **ENGINEER — SCOPED PASS:** Two funded Worker approvals competed for one purchased Company credit and only one reservation committed.
- **CYBERSECURITY — tested-boundary SCOPED PASS:** Native fixture asserts atomic one-credit ceiling; no overreservation or replay writes.
- **REVIEWER — scoped evidence accepted, TECH FULL withheld:** PGlite concurrency only, not genuine independent PostgreSQL16 or provider payment callback; leave real credit-race/security test open.
- **Actual evidence:** SHA `7ff30ea140a5`, test source SHA256 `325648c27efe9ffa26909df71701ac55a43763549246ff597f1febb89c2f18bb`, private raw log SHA256 `774a9eda83a8b68537a9eeb88927784cc49fd9db1e23d2c9360530055d4582ae`, TAP 1 PASS / 0 FAIL / 0 skipped, exit0.

### R124 — M2.01.05 — SCOPED PASS 1/1

**Masterplan workflow:** Worker/company/mixed funding reaches assessment and final credential.
**Exact executed test:** `tests/browser/assessment-funding-notification.browser.test.mjs :: Actual Worker request and Company approval deliver actionable bells through the built worker`.
- **ENGINEER — SCOPED PASS:** Real Worker requested Company funding, Company bell accepted, authorized Company approved, Worker received case bell and start/precheck action with notifications projected via built CLI.
- **CYBERSECURITY — tested-boundary SCOPED PASS:** Unrelated Worker notification denied; two real source outbox jobs and receiving links retained, reloaded Worker case remains owned.
- **REVIEWER — scoped evidence accepted, TECH FULL withheld:** Sandbox billing and local delivery only; scenario mixed worker/company payment and final credential issuance NOT demonstrated by this selected test.
- **Actual evidence:** SHA `7ff30ea140a5`, test source SHA256 `8598dc04c6891f31c175d8514096ef624fe6d3fe1bd0e5d49bb21e9926215578`, private raw log SHA256 `e549bcef24c4c000a266ecbb06681d69dbd35e23e7b27be71efe8f8b6ed63abe`, TAP 1 PASS / 0 FAIL / 0 skipped, exit0.

### R125 — M2.01.06 — SCOPED PASS 1/1

**Masterplan workflow:** Changes requested and rejection propagate to Company and Worker.
**Exact executed test:** `tests/platform/review-resolution-notification-runtime.test.mjs :: Actual escalation and return retain idempotent safe next-actor portal and email jobs`.
- **ENGINEER — SCOPED PASS:** Review escalation and return produced persisted and idempotent safe next-actor portal plus email notification jobs.
- **CYBERSECURITY — tested-boundary SCOPED PASS:** Source-event idempotency and actor-scoped projection validated; no duplicated or unsafe raw review messages.
- **REVIEWER — scoped evidence accepted, TECH FULL withheld:** Native review source event only; Company AND Worker actual visible changes-requested/rejected browser journey and real email provider not covered.
- **Actual evidence:** SHA `7ff30ea140a5`, test source SHA256 `ad4331fab85b31c48ee5e756dbf505cdc462f6686ce8caf2d721923756b9e590`, private raw log SHA256 `d0a44d5b23ae88ed24ff852e615ade688c94edfa15f0bff09942501cd776b3b1`, TAP 1 PASS / 0 FAIL / 0 skipped, exit0.

### R126 — M2.01.07 — SCOPED PASS 1/1

**Masterplan workflow:** Draft/submitted cancellation preserves cases, payments and decisions.
**Exact executed test:** `tests/platform/assurance-order-case-runtime.test.mjs :: M2.01 submitted cancellation closes cases, resolves actions and preserves immutable history`.
- **ENGINEER — SCOPED PASS:** Submitted Assurance Order cancellation closed its open Cases, resolved linked Action Centre obligations, and retained append-only order/case timeline.
- **CYBERSECURITY — tested-boundary SCOPED PASS:** Native cancellation enforces bounded reversals, preserves history rather than delete/credential rewrite.
- **REVIEWER — scoped evidence accepted, TECH FULL withheld:** Native PGlite selected case only; draft cancellation, payment refunds and settled/finalized outcomes require separate browser/adapter checks.
- **Actual evidence:** SHA `7ff30ea140a5`, test source SHA256 `8a6881fd49cc2bdbf65bce081711d4aea51eaf205755ffcff7462ac370999944`, private raw log SHA256 `f39b7bd0961758395b6383a0f9ded926099ff5fc879a574fed5ba87db68e4da1`, TAP 1 PASS / 0 FAIL / 0 skipped, exit0.

### R127 — M2.01.08 — SCOPED PASS 1/1

**Masterplan workflow:** Completed order readiness and reports derive from actual case outcomes.
**Exact executed test:** `tests/platform/company-action-centre-analytics.test.mjs :: M3.04 projects live workflow, approvals, readiness and competency gaps inside the trusted tenant`.
- **ENGINEER — SCOPED PASS:** Company Action Centre analytics projected current workflow, approvals, readiness and competency gaps for the authorized tenant.
- **CYBERSECURITY — tested-boundary SCOPED PASS:** Tenant boundary and projection policy tested in native service; no arbitrary tenant attribution.
- **REVIEWER — scoped evidence accepted, TECH FULL withheld:** Selected M3.04 analytics-native scope supports M2.01.08 partially; exact completed order UI/report/count mix, 320/390 mobile and correlated case snapshot remain unverified.
- **Actual evidence:** SHA `7ff30ea140a5`, test source SHA256 `cb48c684655d6aaf062e3a088b8aac5b2341fb225bdaae025f20083e9e3006a0`, private raw log SHA256 `2844909734ecfee34adf136d103ce0c648f9a6ab8d8e83fa7019ca621e89ed17`, TAP 1 PASS / 0 FAIL / 0 skipped, exit0.

### R128 — M2.02.01 — SCOPED PASS 1/1

**Masterplan workflow:** All submitted evidence kinds queue with correct identity/source file context.
**Exact executed test:** `tests/platform/evidence-review-queue-runtime.test.mjs :: M2.02 runtime queues exactly one immutable evidence-version task and advances case ownership`.
- **ENGINEER — SCOPED PASS:** Review engine queued exactly one immutable evidence-version task and advanced case ownership to next Verifier actor.
- **CYBERSECURITY — tested-boundary SCOPED PASS:** Duplicate task-version binding denied and source lineage preserved in native test.
- **REVIEWER — scoped evidence accepted, TECH FULL withheld:** Single evidence-version native path only, not all submitted evidence kinds, identity/file/Worker/Company real browser/adapter receiving.
- **Actual evidence:** SHA `7ff30ea140a5`, test source SHA256 `9cc9588216bc3c2c40215e94d543d1ffd6bfaa1715d80173029ac9d0c29a0e7f`, private raw log SHA256 `10cc0d4fd54355e5b2aaf2a3a1c398f02e29b3cf2b4e385e5f27f44e96e11a66`, TAP 1 PASS / 0 FAIL / 0 skipped, exit0.

## Technical closure remains blocked

- Private full triple-review JSON `/home/ubuntu/work/.hse-qa-tmp/agency-zero-r119-r128/R119-R128-three-discipline-private-evidence.json` SHA256 `f064ff069ec78e67c2410c90558cfc6cfd36a52eddf2be40a9213ba81eea65fb`; private test progress SHA256 `478fd23ff37f9feb38fdc4aca9fe5618a536ae17c77a0ea04f73bae692e3d287`; compile-only canonical assurance runtime log SHA256 `58dbd0b49f80822c9f4ca148dfa78c539198c830c223108ba80a431655f85891`. Complete raw logs restricted to private vault. No sensitive test password/PII or screenshots committed.
- **Known untested dimensions explicitly not promoted:** R119 expired signed evidence preview; R120 editable draft real browser; R121 all ineligible/funding reasons; R123 real PG16 concurrent credit race; R124 mixed self/Company funding and final credential; R125 Company/Worker changes-requested/rejection actual UI; R126 draft/payment/partly-finalized cancellation; R127 exact completed-order reports/UI counts; R128 all evidence types and actual Verifier receiving. Relevant adapter sandbox contracts and full penetration/negative/UI/a11y not independently signed.
- **ENGINEER/CYBERSECURITY/REVIEWER labels** reflect three scoped QA perspectives in this AI-run exercise; they do not represent three separately authenticated external licensed auditors or full security assessment.
- Original immutable 218 case list, 1611 historic source cases, 4975 planned checklist slots remain unmodified; full verified only through signed attestations on exact source and complete dimensions, not through passing selected tests. External provider-live signoff remains separate launch gate.
- **GitHub inherited release blocker:** two Company source-file modifications proposed in earlier stacked QA PRs are not part of approved frozen app SHA, strict CI policy expected RED. Protected stage still HTTPS200 with PG16/outbox and source pin7ff; unsafe restart/rollback, signed source-to-binary provenance and fresh recovery snapshot still blocked. Do not waive/repin silently.

**NEXT R129:** original M2.02.02 claim/conflict/reassignment/finalization and M2.02.03–.05 review decisions/corrections, then M2.03 worker case, scheduling and receiving. Continue independent cases despite any red; preserve original sources.

**OWNER TESTING READY NO | TECH FULL 0/218 | PRODUCTION UNCHANGED.**
