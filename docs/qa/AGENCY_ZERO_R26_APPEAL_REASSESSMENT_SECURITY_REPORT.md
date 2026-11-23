# ZERO-R26 — Appeal reassessment, payment scope, calibration and renewal security revisit

**Frozen application candidate SHA:** `7ff30ea140a5145e5d5ba761f7c7aef24c895269`, source product unchanged. Related original M2.06.07 / M3.07.03 / M3.07.05 / M3.07.06. **Exactly five distinct source tests within independent R26 batch; SCOPED PASS 5/5, real process exit 0, TAP pass 5 fail 0 skipped 0, duration 53.7 seconds.** Original ZERO-028 positive accepted reassessment and ZERO-050 selected positive outcomes were not needlessly rerun. Still **0/218 TECH FULL; OWNER TESTING READY NO**.

## Five distinct source case outcomes

| Case | Exact test title | Observed scoped outcome |
|---|---|---|
| R26-01 | `Explicit reassessment denies unknown/foreign scope and rechecks live Company link before funding without changing retained application history` | Unknown appeal and foreign Worker/permanent ID/framework rejected. After genuine Worker application, revoked Company link denies payment funding. Application stays PAYMENT_REQUIRED, not funded/no case, immutable event history retained. |
| R26-02 | `Ordinary self-payment remains independent and does not automatically associate an accepted reassessment appeal` | Independent ordinary Worker self-payment generates fresh case without accidentally consuming accepted appeal or adding a reassessment source; original appeal outcome preserved. |
| R26-03 | `A later failed calibration supersedes current calibration for assigned appeal runtime and matching` | Actual Assessor becomes uncalibrated for pinned framework. Claimed appeal follow-up interview and assigned interview read denied; candidate matching marks calibration false. |
| R26-04 | `Actual renewal rejects foreign Worker or unavailable policy provenance and rolls back accepted review` | Foreign Worker appeal rejected; renewal based on unavailable policy provenance fails; old issuance and assurance case intact, no replacement, appeal remains submitted rather than falsely accepted. |
| R26-05 | `M3.07 rejects invalid appeal completion changes and preserves version boundaries` | Domain appeal transition to accepted increments version; invalid backward transition refused. |

**Private raw TAP:** `/home/ubuntu/work/.hse-qa-tmp/agency-zero-r26/R26-five-appeal-reassessment-security.log`, SHA256 `3eb64dec47c3a70e1c69477989b7eba1ef3ecb7e518a0a9526a50bde88a2d1b5`; adjacent receipt JSON includes exact titles, original application SHA, four source hashes, timestamp, process exit0 and TAP5/5.

**Source SHA256:**
- `tests/platform/assessment-appeal-reassessment-runtime.test.mjs` `8f1234c7babf0be52668f6b3bb9bf63dcbf422b04ebf2beae7649de27506ae00`
- `tests/platform/credential-appeal-interview-runtime.test.mjs` `190c3eb2c972f361bfd03344fa9d9e365012752c48f51c6b694cbfa45e9127d3`
- `tests/platform/credential-validity-runtime.test.mjs` `fb31be1a1508179c66510b5a65a6db6ad510f9ed31a34ee015f5320837f1fe1f`
- `tests/platform/credential-appeals-security-runtime.test.mjs` `6d2b38a2db5fdb7fbfa60fcf2e3a73e9ed3ab0ca2dfcd22a5b205e7eb273161b`

**ENGINEER — SCOPED PASS:** Live PGlite source services, account/payment scope, calibration, credential and review-state checks executed. No fresh browser/device/provider workflow this batch.

**CYBERSECURITY — SCOPED PASS:** Foreign Worker/source, revoked Company link, obsolete calibration, unavailable renewal provenance and invalid appeal transition denied; old authoritative histories unchanged. Does **not** certify entire tenant authorization attack surface, real payment/identity/video services or protected HTTPS staging.

**REVIEWER — SCOPED PASS, NOT TECH FULL:** Five exact source test names observed in actual TAP output, process exit0 and distinct source SHA fingerprints. R24 previous five success cases and R25 explicit Company UI source red remain separate; none is counted as a fully verified original 218 scenario.

**Outstanding after R26:** Authorized Company appeal status receiving/privacy proof, complete Worker→Admin→Company/public/PDF credential renewal UI with approved and rejected outcomes, physical interview device, real payment and notification providers, a11y/pen test/load and independent reviewer signoff. [Hosted independent audit 45189020158](https://github.com/itxsam57/hseverify-production-hardening/actions/runs/45189020158) on separate R21 QA source test SHA `08e47344c417df198e065945510df98f1329661e` remained **IN_PROGRESS** at the last check; no pass claim.

**Next:** Guarded QA evidence update to draft appeal QA PR #212; keep source app pinned and production untouched. Check hosted audit terminal/outputs and resume one bounded authorized Company appeal/indirect status browser workflow without exposing appeal grounds to employers unless explicitly permitted.
