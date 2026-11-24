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
