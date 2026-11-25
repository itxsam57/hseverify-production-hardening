# ZERO-R01 — Five original unresolved cases: targeted revisit and source-harness repair

**Candidate app SHA:** `7ff30ea140a5145e5d5ba761f7c7aef24c895269`. **Five original scenario IDs** reviewed in two <=5 units: R01-A (3 original IDs: four selected real tests including the two-test scoring suite), R01-B (2 original IDs: historical CI/stage read-only, five-route isolated smoke, two shard checks). **Three old source reds now SCOPED_PASS_NOT_FULL, two remain inconclusive/blocked. TECH FULLY VERIFIED 0/218, OWNER READY NO.**

| Frozen ID | What was observed | Current scoped verdict | Full three-discipline outcome |
|---|---|---|---|
| `M1.01.01` | Original CSP test reproduced missed short 300ms violation event, longer event/error wait retained exact prohibition and CSP event assertion; real Worker/Company signed-out Chromium source PASS 1/1 | **SCOPED PASS** | ENGINEER targeted PASS; CYBERSECURITY targeted CSP PASS only; REVIEWER incomplete |
| `M1.01.03` | Exact app SHA hosted independent audit still FAILED (6 critical /20 high in historical report); five previously HTTP500 routes now 200/404/307 in isolated test; current hosted browser-shard-spec tests 2/2 PASS | **INCONCLUSIVE / BLOCKED** | ENGINEER historic CI red; CYBERSECURITY full audit not passed; REVIEWER NO-GO |
| `M1.01.04` | Previous stage metadata SHA `d2043b50e3945d2f219356dc5942e4a3710a56d5` != pinned application SHA; no trusted TLS/rollback rehearsal in approved exact-SHA stage | **BLOCKED** | ENGINEER parity unknown; CYBERSECURITY trusted stage/rollback unverified; REVIEWER NO-GO |
| `M1.11.02` | Exact original full 612-second Chromium Worker→Verifier submissions, four evidence kinds, approve/reject/changes-requested, corrected identity and immutable DB final case PASS 1/1 after prior 465-second *external* timeout | **SCOPED PASS** | ENGINEER connected browser PASS; CYBERSECURITY scoped negative only, full pentest pending; REVIEWER incomplete |
| `M2.10.03` | Obsolete query-only fake could not implement actual transaction/live reviewer and used schema ceiling 0113; modernized **original test** with actual PGlite through migration 0127. PASS/FAIL/ADDITIONAL_REVIEW reach correct next owner, immutable FINAL state and double-finalization denial; tenant queue impersonation denied. Entire file **2/2 PASS** | **SCOPED PASS** | ENGINEER selected real DB PASS; CYBERSECURITY ownership negative PASS; REVIEWER broader receiving-role UI/adapter not signed |

## Independent-audit classification (historical, NOT current certification)

- Historical CI run `44915185823` ran on the exact app source SHA and **failed** its independent-audit release gate. Five critical browser reports were signed-out HTTP 500s (`/auth/recover`, sandbox bootstrap root/company/worker, invalid public QR), and the sixth was a legacy browser-shard engineering regression. The 20 high checkpoint findings were fourteen older six-role navigation/auth timeouts and six repeated-login-with-same-TOTP-counter correction timeouts. This is **not** evidence of 26 distinct exploitable vulnerabilities, but neither is it safe to downgrade those severity counts without new full audit.
- In R01, with the pinned app source in new disposable PGlite, five historically 500 routes returned **200, 404, 404, 307, 404** (all no-store and CSP). The four-shard source specification 2/2 PASS. This is targeted non-reproduction, **not** a fresh authenticated full independent audit.

## Exact test-harness fixes (application source UNCHANGED)

- `tests/browser/security-response-headers.browser.test.mjs`: previously checked an asynchronous CSP violation after fixed 300ms, which missed the event intermittently. Now awaits actual missing-resource error with bounded CSP event collection; retains mandatory `script-src-attr` event, blocked nonced inline execution, all hardening headers, no secrets and denied private route. First original failure and new passing original logs preserved.
- `tests/platform/written-scoring-end-to-end-runtime.test.mjs`: original mock only implemented `query` although current `WrittenScoringService` requires `transaction`, actual role/calibration/rubric and migration 0127 for `ADDITIONAL_REVIEW`. First modernization attempt with 0113 ceiling failed expected DB constraint. This second targeted fixture repair runs the real current migration and 3 next-actor dispositions + real cross-tenant queue. Full original QA file 2/2 PASS. Earlier failure and two intermediate logs SHA256 retained.
- Due only to QA source edits, refreshed the **single current test-source-content SHA256** in the immutable historical case index, and its **single parent file SHA256** in the legacy 216 index. **No original IDs, old 1,610 case identities, historic 1,436 green results or 4,975 slot values were modified.**

## Original incomplete acceptance gates and precise continuation

- **R02 highest priority**: run a NEW full independent candidate audit (or fresh protected exact-SHA isolated stage if approved), investigate historical 6 critical/20 high with reproducible evidence. Do not claim historic audit CI is green or stage parity from unrelated d204 SHA.
- The 216 scoped original scenarios still require *all* engineering source/UI/cross-role, true independent cybersecurity adversarial tests and reviewer audits, and relevant adapters, on exact pinned SHA/config. Particularly provider real/sandbox contract, six-role notifications, signed expiry and fallback, legitimate/forged scans, physical screen/mic/camera, realistic load and restoration. No TECH FULL awards made.
- Raw evidence remains private and SHA256-verified; original logs not overwritten. Production/staging/shared DBs unmodified. QA-only source changes are separate from application source, preserve original private audit logs and stable checkpoint in `docs/qa/AGENCY_ZERO_RESUME.md`.

## Raw key source fingerprints

- `M1.01.01` private-workstation:artifacts/agency-zero/ZERO-R01/M1.01.01.robust-event-revisit.log SHA256 `28198892b8e20afe83b822fee8ced834c7b498ae53641dffbe9c4d4f2a8a6e62`
- `M1.01.01` private-workstation:artifacts/agency-zero/ZERO-R01/M1.01.01.revisit.log SHA256 `9a452d2b33994eb85ed8091f612f66da3f4deb0cd6a3759cbc8ad8ca1d8a46a7`
- `M1.11.02` private-workstation:artifacts/agency-zero/ZERO-R01/M1.11.02.revisit.log SHA256 `195608fc4234dad9435e500010ee7b8d81b27916e93f4d07ab3bb2056db2b097`
- `M2.10.03` private-workstation:artifacts/agency-zero/ZERO-R01/M2.10.03.full-modernized-suite.log SHA256 `e858c1d6151db6ae084082e7325b681cec8bc388a7b9b36af2a738f6290c3927`
- `M2.10.03` private-workstation:artifacts/agency-zero/ZERO-R01/M2.10.03.modernized-original.log SHA256 `a7eaf2dee14d3cffd456b6d41bb84720f741691d2d89eb4057f046afbbf31f3b`
- `M2.10.03` private-workstation:artifacts/agency-zero/ZERO-R01/M2.10.03.current-migration-source.log SHA256 `4269a101f8c5726eff7ef5209da19a2fb26887027affb814aa8c696b5e2e7a4d`
- `M2.10.03` private-workstation:artifacts/agency-zero/ZERO-R01/M2.10.03.original-legacy-source.mjs SHA256 `41a77fdec306c6b1a8aa7b7455da85bd1d9ed6c4efccb944f914c4669e9790de`

Recorded UTC: 2026-11-23T03:03:48.650566+00:00
