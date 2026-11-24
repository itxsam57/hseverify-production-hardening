# ZERO-R41–R45 — Five bounded related source-evidence / Company credential checks

**Recorded UTC:** 2026-11-24T11:19:01.520632+00:00. **Current isolated QA branch:** qa/zero-r41-r45-catalog-and-company-security-20261124, based on R40 QA source 91702d8a889147a964ac3e1dafe59cfff423f445. **Frozen original candidate** remains 7ff30ea140a5145e5d5ba761f7c7aef24c895269; NO candidate repin, no production/stage changes or merge. **218 originals, 37 bricks, 58 deterministic batches unchanged.** These are five tightly bounded *case/gate units*, not five fully verified Masterplan scenarios. Full TECH VERIFIED stays 0/218.

## R41 — Historical source-case catalog, one append-only source case
- **Authentic RED:** original `python3 scripts/reconcile-218-prior-test-evidence.py --verify-index` failed, exit1, 1610 archived cases vs 1611 actual source cases.
- **Scoped GREEN:** append exactly ONE genuine R18 `tests/browser/m3-04-company-action-centre-mixed-status.browser.test.mjs#f30fb16967693ac0` record, `NO_PASS_LOG_EVIDENCE`, empty proof+scenario links; preserve all previous **1610/1610 entire source-case objects EXACTLY** (same order), all original **218/218 scenario records EXACTLY**, and baseline **1436 historical source greens**. Only four count fields (source file count 561→562, cases 1610→1611, no-green 174→175, actual source-files digest) updated. Archived original CI input reused from existing immutable private baseline 30/30, `scan_historical=False` to avoid inventing new observed historical pass. Script `--verify-index` **exit0**.
- ENGINEER **SCOPED PASS**; CYBERSECURITY **SCOPED PASS** hash/provenance fail-closed; REVIEWER **SCOPED PASS** invariant checks, not execution of R18 case. R18 browser may have other saved evidence but not automatically historical green.

## R42 — Legacy 216/218 evidence pointer and scope
- **Actual change:** update ONLY `prior_distinct_test_index_sha256` in `MASTERPLAN_218_LEGACY_216_OBSERVATIONS.json` to match the new actual index; preserve all other legacy fields and earlier observation records.
- **GREEN:** `python3 scripts/reconcile-216-historical-scope.py --verify-index` exit0; **216 old scoped**, **316 old references**, **307 clean**, M1.01.03 and M1.01.04 still missing old scoped proof, **0 fully certified**.
- ENGINEER **SCOPED PASS**; CYBERSECURITY **SCOPED PASS** pointer integrity; REVIEWER **SCOPED PASS**, no new access, UI or adapter outcome.

## R43 — Original 4,975 planned-slot summary reconciliation
- **RED:** `python3 scripts/reconcile-4975-prior-coverage.py --verify` exit1 after R41 because summary source-case total stale at 1610.
- **Root proven:** recomputed **all 4975 CSV rows byte-for-byte equal**, exactly ONE summary field differed `scoped_source_test_case_total` 1610→1611. Changed only that value; 4975 planned checks, 693 partial links, 100 uncertain, 4182 unlinked, **0 fully certified** remain unchanged.
- **GREEN:** rerun same unchanged `--verify` exit0.
- ENGINEER **SCOPED PASS** source-only count; CYBERSECURITY **SCOPED PASS** no green or planned-slot laundering; REVIEWER **SCOPED PASS**, independent full launch verification still outstanding.

## R44 — Frozen candidate runtime integrity negative test
- **GREEN negative:** `python3 scripts/agency_zero_control.py --check` **expected exit2**, correct rejection `Pinned application candidate has runtime drift; retarget candidate and selectively recheck: src/app/company/(portal)/workers/page.tsx`. This is the separate R40 Company table semantic source patch. Never bypass or record as successful positive `--check`.
- ENGINEER **SCOPED PASS** for expected guard behavior; CYBERSECURITY **SCOPED PASS** for fail-closed source provenance; REVIEWER **BLOCKED for integration**: app source pin remains 7ff, needs controlled merge/repin/revalidations, no TECH FULL.

## R45 — Real foreign-tenant credential policy rejection (one original-related security case)
- **Actual executed** `node --test --test-concurrency=1 --test-name-pattern=... tests/platform/credential-validity-runtime.test.mjs`: **1/1 PASS exit0** against disposable domain/database fixture, original test `A policy snapshot outside the case tenant fails closed rather than issuing unspecified validity`.
- Source-reviewed assertions: uses `repo.saveDecisionAndProgressCase` with a **foreign tenant's policy snapshot**, requires reject /policy|tenant/, and verifies database `credential_issuances` count 0. No mock success, no external provider or browser assertion credited from this single case.
- ENGINEER **SCOPED PASS**; CYBERSECURITY **SCOPED PASS** one actual negative cross-tenant issuance boundary; REVIEWER **INCOMPLETE for whole credential workflow**: real Company/Worker multi-role UI and complete penetration testing not covered here.

## Source integrity, limits, actual receipts
All 5 scoped units are related to preserving actual Company Worker/credential evidence and protected candidate acceptance. R41 and R43 repeats are identical fixed-assertion retests after the one genuine ledger repair and do **not** add units or historical pass claims. R45 is one platform case, not the ten-case test file in aggregate. The R40 full Company credential browser is **not rerun or double-credited**. No **shared** database, staging or production mutation; the R45 security case used an isolated ephemeral PGlite test database.

Raw private/ignored artifact filenames and SHA256:
- R41 RED: `.autopilot/artifacts/zero-r41-original-index-red.log` — `e80827c30dfd9a08445eee5b8af02b6136a218fa52075b8eec40a4446d574853`
- R41 GREEN: `.autopilot/artifacts/zero-r41-historical_source_case_catalog.log` — `40c9d7483f1311990a700f4a67bf3bb06c55511458627f74cb315ac6f1f7c9b3`
- R42 GREEN: `.autopilot/artifacts/zero-r42-legacy_216_historical_scope.log` — `e3d1168b012754ef83276342079a8561360220b3bd71d4ba53ead134343f4812`
- R43 RED: `.autopilot/artifacts/zero-r43-4975_previous_planned_coverage.log` — `276ed8d99bf4fcbbb2253698f49b98975b932f8093b817805b59c79a297b6aa5`
- R43 GREEN: `.autopilot/artifacts/zero-r43-4975_previous_planned_coverage-green.log` — `d1e4bd3b4d470a27051162d903ddc7313b920b00b5c2cb1fb97d764d18e357ca`
- R44 GREEN NEGATIVE: `.autopilot/artifacts/zero-r44-frozen_candidate_runtime_drift_denial.log` — `483f26470e7ff7119e161ae6329159487f72c71d3f10c9a1d1fbbe43f7684960`
- R45 GREEN: `.autopilot/artifacts/zero-r45-foreign-tenant-credential-security.log` — `44d94dc0bd994afc224cdbb2314d68f3a299269d927434b9fd4a5b0062dd0647`

The saved current source-index SHA256 is `5d379e5ca1313fb0e0718724de7785896bb302f3b91ddb1a3ff9ad4e74d353e0`. New planned-slot summary SHA256 `3fa65c34cde7038e6a13e3249e034b706a63bab8a3972a58b5d6f3213780deed`.

**NEXT:** Guard commit/push QA-only draft PR stacked on R40, inspect exactly which hosted CI checks pass/fail. The source pin failure is **expected and not waived** until a reviewed integrated candidate + selected regression. Then resume remaining 58 open original batches with full ENGINEER/CYBERSECURITY/REVIEWER/adapter outcomes. Do not invent TECH FULL, automatic scenario credit, security pentest completion or consumer launch approval.

## Hosted CI regression check and repair (follow-up on the SAME R41 catalog fix)
- Original [PR #225](https://github.com/itxsam57/hseverify-production-hardening/pull/225) QA head `a85c4ae3e75cbc383b9a06f7fa4689c641295b91` hosted **FAIL**: [historical inventory run 45383433837](https://github.com/itxsam57/hseverify-production-hardening/actions/runs/45383433837) `test_prior_test_evidence.py` still asserted obsolete 1610 twice; [fail-closed 218 ledger run 45383433802](https://github.com/itxsam57/hseverify-production-hardening/actions/runs/45383433802) asserted obsolete 1610 once. Both hosted run stderr and exact exit are preserved privately SHA256 `0ef69fc23e9fcaa1dae177811a73be909fcf7c8afaa1be4e6755e80c02e002e3` and `36cb460a74c0bab6bbaead9cd510da3d62801ec528254ff9b2d39f9791e393c4`. Previous frozen-source gate still **correctly FAILS** exit2 on proposed R40 app source drift, unrelated to source-case index.
- Root-cause corrective QA test maintenance: `tests/engineering/test_prior_test_evidence.py`, `test_legacy_216_evidence.py`, `test_vertical_218_progress.py`, `test_4975_prior_reconciliation.py`, and `current-release-218-ledger.test.mjs` now explicitly expect **1611 source cases, 175 without prior green**, while retaining strict **1436 historical greens**, **218 original**, **0 FULL**, 4975 unpromoted. Test source titles, old source-case identities and old proofs are unchanged; tightened assertions explicitly verify appended R18 has `NO_PASS_LOG_EVIDENCE`, empty proof and zero scenario links.
- Unassigned triage `scripts/triage-218-unassigned-tests.py`: previously **1109** rows, now **1110** due exactly one new R18 source case. Validated **ALL 1109 old CSV rows bit-for-bit at field level**, one uncredited new row, 942 historically green-unassigned unchanged, no-green 167→168, 1102 nonbinding text suggestions. Updated `MASTERPLAN_218_UNATTRIBUTED_CASE_REVIEW_20261114.csv`, original 218 association unchanged and no textual suggestion credited.
- Updated current test source SHA256 fingerprint in original source index to `f77f5ee08c86b9dedcc436940525a66fe7c63dc0d128b70c972446f439a2d037` and legacy pointer to the exact new index SHA256 `ad30a702ec3a847255b4928a44e408ec16169ebc47eec44b3ec2fc0a46b9b452`. Summary 4975 remains source cases 1611, final certified 0.
- **Locally executed ALL ELEVEN existing CI/release guard commands PASS exit0** on source/test fixes, including 8 original archived-proof tests, 5 legacy tests, 9 planned-slot tests, 4 vertical progress tests, 8 current-release Node ledger tests, plus Python/Node index verifiers, triage and action map. These are existing multi-case *release guards*, not additional scheduled original-scenario workflow units R41-R45.
- **No hosted confirmation on updated fix yet**: push the guarded QA branch and inspect fresh PR checks. An exact frozen candidate source-pin failure is still expected for the earlier R40 proposed application patch, and is not waived.

Postfix CI release guard receipts (2026-11-24T11:27:22.683391+00:00 UTC):
- `.autopilot/artifacts/zero-r41-postfix-guard-action_map.log` SHA256 `3899d1dc72360a96e8d5d1a59c394be48b58fbc4353d257ae2a99193ba9cd1d1`
- `.autopilot/artifacts/zero-r41-postfix-guard-catalog.log` SHA256 `6ae0dc2c5566e99a3339264c376b0479cf7021f25bd706ade328456e963b44f2`
- `.autopilot/artifacts/zero-r41-postfix-guard-current218_node_tests.log` SHA256 `d3d511a922094c8abe0468191fb199995deb6533e99a4dcb8a4ed98964348284`
- `.autopilot/artifacts/zero-r41-postfix-guard-current218_reconcile.log` SHA256 `0211d60c6bf777f225711011cab23ebb204545baf68bbbc96aaaa60233646a7f`
- `.autopilot/artifacts/zero-r41-postfix-guard-legacy.log` SHA256 `155359f702087be7af7a9613d68cbd49c9fd29758b81dd1330d29c4543c5e0c7`
- `.autopilot/artifacts/zero-r41-postfix-guard-legacy_test_suites.log` SHA256 `b7fe3ea8904c1ea213881f8574233240862081bbc9fad87d6d897d240881285f`
- `.autopilot/artifacts/zero-r41-postfix-guard-prior_test_suites.log` SHA256 `19f3bde38463ba86bf819ddcdff2d6825362af92367312ca85137e69ac83897a`
- `.autopilot/artifacts/zero-r41-postfix-guard-slots4975.log` SHA256 `783142719fb1dbd053b696c1630fb79a4edd2933c82731dd34b4ca204813541c`
- `.autopilot/artifacts/zero-r41-postfix-guard-slots4975_test_suites.log` SHA256 `6774981d4146a2dfe0f35082e724b80e7c6dd11dc0a51265c9845e87796186fb`
- `.autopilot/artifacts/zero-r41-postfix-guard-unassigned_triage.log` SHA256 `444963e65ddfdfd1de43226762647df1944885b660c6b8850372e4c22021fa04`
- `.autopilot/artifacts/zero-r41-postfix-guard-vertical218_test_suites.log` SHA256 `daa2bf1708ef1eec6951cfb75a7298035ad901b872024249d15c15a168c07202`
