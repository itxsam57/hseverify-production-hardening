# ZERO-003 — Authentication, five original scenarios revisited

**FIVE SOURCE CASES SCOPED PASS; FIVE ORIGINAL SCENARIOS STILL OPEN, TECH FULL 0/218, OWNER TESTING READY NO.**

Frozen application SHA 7ff30ea140a5145e5d5ba761f7c7aef24c895269 from clean detached checkout. Synthetic disposable PGlite/database, local Next/Chromium where applicable; no shared stage/production edits. Exactly one newly executed independent original source case per five original scenario units. Original AGENCY_ZERO_BATCH_003_REPORT.md documented another five prior scoped cases; not repeated now.

## Per original scenario, three disciplines

### M1.03.01 — Failure to persist acceptance rolls back the Worker account, flow and OTP

Test source: tests/platform/worker-registration-policy-runtime.test.mjs SHA256 cc6af8c7ed5af3dd751f81c595cb9bd75de1051d659f19ef33ea2e548611ccce. Actual TAP **1 PASS / 0 FAIL / 0 SKIP, exit 0**, log SHA256 029bec8fe661ed7e087aa99b3e3d1d57ece9a557e8a7f79c2b7faeda9321366d.

- **ENGINEER:** PGlite registration acceptance persistence fault rolled back Worker account, signup flow and OTP together; original real Worker registration invalid fields/terms/mismatch previously browser-tested on same pin.
- **CYBERSECURITY:** Fail-closed atomicity under induced acceptance-history write failure; no external email/SMS live delivery and incomplete arbitrary input/rate-limit/cross-tenant attacks.
- **REVIEWER:** Model-checked raw TAP and source-case identity on frozen pin, not independent accredited agency or complete visual/onward activation approval.
- **STILL OPEN:** Complete full signup→verified Worker→profile cross-role state, external adapter failure/retry/idempotency, accessibility and pen test.

### M1.03.02 — Real Company browser refuses expired email OTP and cross-origin resend, then allows only fresh resend

Test source: tests/browser/company-registration-expired-otp.browser.test.mjs SHA256 a84b28b15072468a85b357ae0d96a0be245766a1247874df2ae7c1e9a1e64dbd. Actual TAP **1 PASS / 0 FAIL / 0 SKIP, exit 0**, log SHA256 9cc50bee42f224f4a4f4fc6c31121adcea8442493184e5cda52dd6a5d3ec9339.

- **ENGINEER:** Real Chromium Company OTP rejects expiry and cross-origin resend, then fresh OTP resend works; original Worker dual email/phone verification browser scoped evidence retained.
- **CYBERSECURITY:** Negative expiry/cross-origin boundary executed; complete wrong/lockout/replay/device swap/time-race/CSRF and provider contract delivery not attested.
- **REVIEWER:** Raw browser/TAP identity + hash and exact behavior reviewed; Worker and Company OTP journeys still not independently approved end to end.
- **STILL OPEN:** Full email and phone OTP retry/replay/exhaust across roles, UI/mobile/accessibility, provider delivery/intents and independent security review.

### M1.03.03 — two real Worker registrations verify email+phone OTP and cannot duplicate Worker ID or apply for exams

Test source: tests/browser/worker-two-otp-accounts-duplicate-assessment.browser.test.mjs SHA256 4283d05cdf95d7897282b070d73110e47bd94a2a67773ddb9b9978d6d3e823ab. Actual TAP **1 PASS / 0 FAIL / 0 SKIP, exit 0**, log SHA256 20da9be31832f9c6ebf808c1131acfa845a365146f5e210f6b58ba25bb977543.

- **ENGINEER:** Two real Worker browser registrations consumed synthetic email+phone OTP and signed in; duplicate permanent Worker ID and assessment application denied, checking cross-account handoff.
- **CYBERSECURITY:** Second-account identity merge and assessment-access denial exercised; no full concurrent duplicate/race/account-enumeration/tenant and session abuser campaign.
- **REVIEWER:** Raw actual Chromium output and source assertions confirmed, no full stakeholder/other-tenant acceptance.
- **STILL OPEN:** Race/duplicate cross-tenant case, recovery enumeration, different-device/session replay, broader receiving-role UI and independent pentest.

### M1.03.04 — Company email exhaustion commits five rejections and immutable audit; correct exhausted code cannot advance

Test source: tests/platform/company-registration-otp-runtime.test.mjs SHA256 bf9c0d70fbf3906b4e840d67305a32db5163ed14cbe25cc2a6bab47e62081a76. Actual TAP **1 PASS / 0 FAIL / 0 SKIP, exit 0**, log SHA256 d271aa0f6a668f76c9ae83449b63e62b387b20d0f6952105d3425fef1a10880b.

- **ENGINEER:** PGlite Company email challenge commits five rejected OTP attempts and audit; even correct code cannot advance exhausted challenge. Original pending-tenant owner email/MFA browser scoped evidence retained.
- **CYBERSECURITY:** Account lockout/audit integrity under exhaustion source case verified; real PostgreSQL contention, full MFA token replay and provider outages remain unverified.
- **REVIEWER:** Raw targeted fail-closed source test examined; not evidence Admin/Root company approval or all review/activation states complete.
- **STILL OPEN:** Complete Company approval handoff, recovery, multi-tenant wrong-role, real DB concurrency, OTP adapter contracts and mobile UI.

### M1.03.05 — Issuer revocation blocks a fresh token and an already-open enrollment

Test source: tests/browser/staff-invitation-revocation.browser.test.mjs SHA256 86fa6a340a08471722f83bd9c18dfff7a50a0ae8c992338b34cab32fde707f31. Actual TAP **1 PASS / 0 FAIL / 0 SKIP, exit 0**, log SHA256 ba6fceb456a20e73e40e8c6ec286bbae99e772b912af828666142061447bf1f5.

- **ENGINEER:** Real Chromium issuer revocation rejects fresh invitation and already-open cached MFA enrollment, removes unfinished account, preserves immutable audit; original staff cancel/reopen scoped browser retained.
- **CYBERSECURITY:** Stale-token revocation, cached enrollment and canceled account negative checks passed; spent/expired/replay all five staff roles and issuer-ownership abuse matrix not fully verified.
- **REVIEWER:** Verified explicit browser console proof, source identity and stored audit assertions; not final five-role receiving portal/independent security acceptance.
- **STILL OPEN:** Used/expired/replayed invitations across all staff roles, role-bound activation/sessions after revocation, full browser/mobile review and provider adapter delivery.

## Private evidence and limits

- Combined raw receipts with three-role assessment: /home/ubuntu/work/.hse-qa-tmp/agency-zero-post58-zero003-auth/ZERO003-five-scenarios-three-discipline.json SHA256 f2580689fcbed87f63d05cf4c9ccdcb9bf3fe99629dfc3b21510912974eb9f72.
- M1.03.01 receipt M1.03.01-fresh-revisit.json SHA256 a7ce9519bb44e9738370e869bfa95c8e5c7e7d30b56e79a1a9569de8e186bdf1; raw log M1.03.01-fresh-revisit.log SHA256 029bec8fe661ed7e087aa99b3e3d1d57ece9a557e8a7f79c2b7faeda9321366d; config fingerprint c32950ef8f9d760975064a8440de02cfd893bf211550bf3a0c4b91cbc90e2604.
- M1.03.02 receipt M1.03.02-fresh-revisit.json SHA256 e167838c9583087428fe1bb09c7503f02b6efa1d08f7d5be9a7ee3dca0531c50; raw log M1.03.02-fresh-revisit.log SHA256 9cc50bee42f224f4a4f4fc6c31121adcea8442493184e5cda52dd6a5d3ec9339; config fingerprint df025cee80ce6731c12dca29133f4de11491daaf5c152e6dd59cf91fbef1476b.
- M1.03.03 receipt M1.03.03-fresh-revisit.json SHA256 9c529cd8020f7555085fc4877ee954a820946964f444017db2d77092ae82a777; raw log M1.03.03-fresh-revisit.log SHA256 20da9be31832f9c6ebf808c1131acfa845a365146f5e210f6b58ba25bb977543; config fingerprint 66d1209cd9ad1f4ce02d47ac4d05aa0651f8f3c15b921a6f7dfde73974e91d5b.
- M1.03.04 receipt M1.03.04-fresh-revisit.json SHA256 9075e0c623b3599806aa3f9f3a3e26f735a2e7b8b548270249f9d62f6f6563fd; raw log M1.03.04-fresh-revisit.log SHA256 d271aa0f6a668f76c9ae83449b63e62b387b20d0f6952105d3425fef1a10880b; config fingerprint 395d3459d6c98234f9b7aca363e8c3811fbbb7cc8ba0aa3b677728e78f3a8349.
- M1.03.05 receipt M1.03.05-fresh-revisit.json SHA256 8fe5e845adc1285b479b3e841e93124084ce9fb0ea6acad19f318ef82374ef05; raw log M1.03.05-fresh-revisit.log SHA256 ba6fceb456a20e73e40e8c6ec286bbae99e772b912af828666142061447bf1f5; config fingerprint b9eb5c672dc7c989e5756d8d5ef8eb71c1a590719ea0eb4392d6066bebe927a2.

**No scenario receives technical full verification from an isolated browser or platform test alone.** Full connected UX/accessibility, six-role negative and adversarial security validation, independent reviewer acceptance and applicable synthetic provider adapter contracts remain. Full scenario high/critical count is UNKNOWN. Actual live email/SMS provider delivery is a separate launch gate.

Separately hosted independent audit #45603019052 on changed QA SHA91702d8 FAILED a Verifier/Case Replay scoring regression; exact pinned7ff isolated test PASS1/1 does not clear the changed-SHA CI. Source pin7ff unchanged. Draft PR224 not merged and protected staging signed release/rollback blocked.

## Next bounded action

Original ZERO-004 up to five source/workflow units, first check existing historical evidence. Preserve unresolved ZERO-001/002/003 in original 58 OPEN revisit batches. No R-series, no production or staging changes.
