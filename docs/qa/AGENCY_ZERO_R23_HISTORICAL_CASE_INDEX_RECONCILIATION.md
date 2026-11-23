# ZERO-R23 — Append-only historical source-case catalog reconciliation

**Original 218 scenarios preserved; TECH FULLY VERIFIED 0/218.** Baseline QA source SHA `752d4cfc37f9f4e82b1cab9bc08cfef6783af70e`. Scope is **evidence index integrity only**, not a newly full-verified original scenario; this operation adds exactly one uncredited source test. No application code, test body, migration, production or staging change.

## Pre-change observed failure
- Existing `docs/qa/evidence/MASTERPLAN_218_EXECUTED_TESTS.json` reported **561 source test files and 1,610 historical distinct source tests**, but the current QA source had **562** after the separately saved R18 Company mixed-status Chromium test was added.
- `python3 scripts/reconcile-218-prior-test-evidence.py --verify-index` **failed** because `len(archived["cases"]) != len(current source_catalog)`. Real raw initial failure at `/home/ubuntu/work/.hse-qa-tmp/agency-zero-r23/R23.baseline-index-red.log`, SHA256 `3930722096c67cca31cba8f0b165eb45f6bbd4dc9dfa25c62e6da1bbd7ef3dfa`. No attempts to treat the new test as a historical green.

## Source-provenance preserving rebuild
The repository's own `scripts/reconcile-218-prior-test-evidence.py` `build()` was used with the 30/30 **archived prior exact CI log reference snapshot** from the frozen 2026-11-14 baseline, and `scan_historical=False` to avoid inventing a new scan of archived/offline raw historical logs. It conservatively reused only reviewed old hash-linked proofs. Before writing:
- **1,610/1,610 previous case records compare EXACTLY** (entire dictionary including proof entries, scenario links, status, IDs, repeats); no lost/replaced case IDs or provenance.
- All **218 original frozen scenario records compare EXACTLY**. Same 37 related groups / 58 ZERO batches and technical FULL 0.
- Exactly **one** newly discovered source case: `tests/browser/m3-04-company-action-centre-mixed-status.browser.test.mjs#f30fb16967693ac0`, title `R18 actual signed-in Company Action Centre derives mixed cases and a cold PGlite server sees resolved values`; classified `NO_PASS_LOG_EVIDENCE`, with **no** automatic scenario credit. The separately recorded R18/R22 scoped browser logs remain outside historical baseline proof (rightly not marked historical green).
- Archive old list of 1,610 source cases was preserved as an **unchanged prefix**, new source record appended at end, so existing history order was not changed.
- Only 4 `counts` fields update: `current_source_test_files 561→562`; `static_existing_distinct_test_cases 1610→1611`; `source_tests_without_green_execution_proof 174→175`; and the genuine current source-file SHA256 aggregate. **Old green count stays 1436** (232 exact historical CI + 1204 other historical green). All old raw-log scan statistics, original inventory start SHA and frozen scenario associations unchanged. This does **not** rerun old tests or claim their candidate SHA green.
- Updated `docs/qa/evidence/MASTERPLAN_218_LEGACY_216_OBSERVATIONS.json` only its `prior_distinct_test_index_sha256` pointer to the new true catalog SHA; preserves 216 old scoped-case observations and 2 missing old scoped evidence cases.

**Hash provenance**: old case-index JSON SHA256 `db8b68c1e388d5264f85c5b1639490f0afaeacaec8bd8b936df9aee9a92d94ae`, new index JSON SHA256 `15f3ed6e23eaa1ff0694d7d004fc99e860321dd1ad77545f24e03c4cbe94e83b`; legacy pointer updated only after verifying it originally referenced old index.

## Independent checks actually performed
- `python3 scripts/reconcile-218-prior-test-evidence.py --verify-index` **PASS**: `distinct_source_cases=1611`, `previous_green=1436`, `full_verified=0`.
- `python3 scripts/reconcile-216-historical-scope.py --verify-index` **PASS**: old 216 scoped scenario refs preserved, **0 fully certified**; old missing `M1.01.03/M1.01.04` remain visible.
- `python3 scripts/agency_zero_control.py --check` **PASS**: 218 originals /37 groups/58 batches <=5 each / app SHA frozen.
- `git diff --check` **PASS**, no application source changes. No indexed scan claims or fresh green cases fabricated.

## Three role reviews
**ENGINEER — SCOPED PASS:** build/catalog fingerprint and historical identity invariants verified with actual source code. **CYBERSECURITY — SCOPED PASS:** fail-closed index verification remains enforced; hash-pointer and immutable old proof gate retained; no security or product boundary code changed. **REVIEWER — SCOPED PASS:** original source case count, old proof/association parity, original frozen 218 rows and new uncredited test audited. Full independent launch/pentest/provider signoff not implied.

**Parallel latest QA status:** R20 two-tenant mobile layout fix draft [PR #208](https://github.com/itxsam57/hseverify-production-hardening/pull/208), R21 notification rollback fixture draft [PR #209](https://github.com/itxsam57/hseverify-production-hardening/pull/209) and R22 cold restart TOTP test draft [PR #210](https://github.com/itxsam57/hseverify-production-hardening/pull/210) are **still separate unmerged QA-only changes**. If any future PR changes any test file or adds a new test, its current source digest / catalog must be recomputed *after* integrating in a protected QA candidate, preserving historical provenance. Independent full audit [45189020158](https://github.com/itxsam57/hseverify-production-hardening/actions/runs/45189020158) still IN PROGRESS at last check; do not claim global green.

**NEXT:** guarded commit/push this append-only historical data repair on a separate draft QA PR, check exact hosted audit terminal outcome, then integrate in protected QA review order without production deployment or TECH FULL award.
