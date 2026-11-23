# ZERO-R14 — Original M1.11.07 supervisor observation security revisit

**Source candidate SHA:** `7ff30ea140a5145e5d5ba761f7c7aef24c895269` (unchanged). **Related original scenario:** `M1.11.07` from ZERO-016, *one* original Masterplan scenario; **five distinct new targeted security test-case executions** from `tests/platform/supervisor-observation-runtime.test.mjs`. Five cases **5/5 SCOPED PASS**, **0 new TECH FULLY VERIFIED**. This run **does not** repeat historical full Company→Worker→Verifier browser source test; preserved original `artifacts/agency-zero/ZERO-016/M1.11.07.log` SHA256 `cb0b3ca32c9798e33735f130394ff043c6ef4a74fa51c19dff8c8f42511ebb34` (1/1, 218.6s) already documents role UI, 320/390/1440, nine review decisions and feedback, and mixed case blockers.

## Five executed distinct security assertions (real source PGlite; NOT an external pentest)

1. **Wrong supervisor:** `Supervisor declaration cannot be signed as another member` — PASS; service rejects other Company membership while signing.
2. **Revoked Company:** `Revoked Company session cannot create signed evidence` — PASS; live DB session revocation prevents new observation.
3. **Revoked Worker:** `Revoked Worker session cannot acknowledge or read evidence` — PASS; both acknowledgement and history read denied.
4. **Tampering / replay:** `Signed supervisor source and acknowledged comment cannot be overwritten` — PASS; second acknowledgement, direct SQL declaration update and direct SQL comment replacement rejected.
5. **Queue bypass:** `Company cannot queue an unacknowledged supervisor declaration` — PASS; no `supervisor_observation` review task after unauthorized queue attempt.

**Source file SHA256:** `8a73188151b09abb47afefe030d1cf8940807626d1e26a1fcfcd8e0f14be3176`.
**Private raw TAP:** `/home/ubuntu/work/.hse-qa-tmp/agency-zero-r14/M1.11.07.five-security-cases.log`, SHA256 `ff2dd4b78dc6f02eca6bfcf6d91e946d90580272b1831d6302c6ba3de6db2402`. Actual Node test exit **0**, TAP **5 tests, 5 pass, 0 fail, 0 skipped**, 24.0 sec. Receipt `M1.11.07.five-security-cases.receipt.json` in private sibling directory. Configuration: PGlite in-memory test; no live providers or production credentials.

**ENGINEER — SCOPED PASS:** Existing source service and test fixture actually operate DB membership, sessions, immutable observation detail rows and evidence review queues. Negative outcomes pass; independent application browser journey earlier passed separately. No new UI walkthrough this batch.

**CYBERSECURITY — SCOPED PASS:** Forged supervisor identity, revoked sessions, signed-source rewriting, duplicate acknowledgement and missing Worker approval queue bypass rejected in actual DB/service. Remaining: full malicious tenant BOLA/CSRF/race/security scan and other role/adapters, and explicit standalone independent adversarial review not signed.

**REVIEWER — SCOPED PASS (not certified):** Five source case identities match the five executed TAP lines, original M1.11.07 preserved and source hash locked; no double-counting historical browser case. Cannot mark complete independent role/UI/security/adapter verification, so TECH FULL remains 0/218. Not representing the assistant as an external accredited third party.

**CI context:** Patched independent hosted [run 45112527041](https://github.com/itxsam57/hseverify-production-hardening/actions/runs/45112527041) on exact CI SHA `88ba8ca5abefc82bc7c1c56a3acedc70eed21749` remains **IN_PROGRESS at record time**, after successful Poppler install, in full regression crosscheck. No green claim.

**Next:** Once CI terminal result exists, inspect final audit and full regression, verify no severity critical/high regression failures. Continue bounded M1.11.06 leaving-letter previews or next unreconciled security contract. Do not merge/deploy; 0/218 TECH FULL.
