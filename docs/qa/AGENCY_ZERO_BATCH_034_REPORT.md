# ZERO-034 — Written scoring and review technical evidence

**5 of at most five original related workflow units attempted.** Selected source case results: **4 PASS**, **1 FAIL/UNPROVEN**. **0 newly TECH FULLY VERIFIED.**

Source application SHA: `7ff30ea140a5145e5d5ba761f7c7aef24c895269`. QA tooling SHA at run: `7e506a5bed84e9e1ae3141697efb2a9749843eb3`. Original app/prod/staging were not modified. Local synthetic fixtures; real browser cases where indicated.

| Original scenario | Selected source test | Outcome |
|---|---|---|
| `M2.10.01` | M2.10 written scoring route crosses the real browser boundary | SCOPED PASS |
| `M2.10.02` | Reasoned amendment preserves original and records immutable version link | SCOPED PASS |
| `M2.10.03` | written scoring runtime completes a real review lifecycle through service boundary (1.48433ms) | FAIL_OR_UNPROVEN |
| `M2.10.04` | Declared scoring conflict removes live authority and hands the retained draft to Admin recovery | SCOPED PASS |
| `M2.10.05` | M2.10.05 real Admin calibration FAILED and time-expired CURRENT block Verifier and show Worker holding state; live renewal restores review | SCOPED PASS |

## Three discipline reviews — not independent certification

**ENGINEER:** Selected checks performed in the actual source application and/or isolated DB, with real input/role assertions where present. At least one check failed or could not be proven; triage from raw log required. Complete route inventory, cross-role connected effects, maintainability and responsive UI are not fully audited.

**CYBERSECURITY:** Selected negative, permission, file or race assertions were exercised only to the extent verified in each case source. No entire attack-surface, penetration-scope, independent replay, security race, provider contract or load assurance is implied. High/critical vulnerability count for full app: **UNKNOWN**.

**REVIEWER:** Original ID, title, selected test log and result accounted for, but full original Masterplan workflow/visual/code independent signoff has **not** been completed. No claim of accredited third-party review.

## Outstanding per-case test scope

- `M2.10.01`: No direct older source-case link; discovered related case must be mapped/reviewed. Remaining complete role/UI/security/adapter-contract/reviewer evidence to be gathered.
- `M2.10.02`: No direct older source-case link; discovered related case must be mapped/reviewed. Remaining complete role/UI/security/adapter-contract/reviewer evidence to be gathered.
- `M2.10.03`: No direct older source-case link; discovered related case must be mapped/reviewed. Investigate selected test result FAIL_OR_UNPROVEN without discarding other evidence.
- `M2.10.04`: No direct older source-case link; discovered related case must be mapped/reviewed. Remaining complete role/UI/security/adapter-contract/reviewer evidence to be gathered.
- `M2.10.05`: Remaining complete role/UI/security/adapter-contract/reviewer evidence to be gathered.

## Raw test evidence (workstation-private; SHA256)

- `M2.10.01`: `private-workstation:artifacts/agency-zero/ZERO-034/M2.10.01.log` — SHA256 `5cf0ba57977367239b6ff3d45daec29390f33e2953ccd0604fb087c48cb4038c`, selected run exit 0, TAP {'tests': 1, 'pass': 1, 'fail': 0, 'skipped': 0}.
- `M2.10.02`: `private-workstation:artifacts/agency-zero/ZERO-034/M2.10.02.log` — SHA256 `c7f9b1695d8e701adcb5c45bea07ed4576d8f16c9f3243c79c3804b862d118e9`, selected run exit 0, TAP {'tests': 1, 'pass': 1, 'fail': 0, 'skipped': 0}.
- `M2.10.03`: `private-workstation:artifacts/agency-zero/ZERO-034/M2.10.03.log` — SHA256 `9b56da23b274580e5622d63b76b28be3c8c6efd0c4f4a4945c213d9dd3824ab3`, selected run exit 1, TAP {'tests': 1, 'pass': 0, 'fail': 1, 'skipped': 0}.
- `M2.10.04`: `private-workstation:artifacts/agency-zero/ZERO-034/M2.10.04.log` — SHA256 `d312836632c9e5c0d269520c67cb6b8d644c0ef90ada4e0f410077773c296927`, selected run exit 0, TAP {'tests': 1, 'pass': 1, 'fail': 0, 'skipped': 0}.
- `M2.10.05`: `private-workstation:artifacts/agency-zero/ZERO-034/M2.10.05.log` — SHA256 `2e71e7e1d0453fc43c5950b67efb7c853cd3bd20b3c443cb35916c3a25f6c93d`, selected run exit 0, TAP {'tests': 1, 'pass': 1, 'fail': 0, 'skipped': 0}.

## Exact continuation

This batch is recorded as attempted/incomplete, **not confirmed**. Save raw evidence; do not repeat passed scoped tests without a changed candidate or reason. Continue next separate related batch while the unfinished security and independent reviews stay in the original unresolved queue.

Recorded UTC: 2026-11-22T19:55:11.236521+00:00

## Source-versus-original completeness: expert closure gaps

- `M2.10.01`: Selected real browser verifies written-scoring route only, not full authorized reviewer answer/rubric disclosure matrix for every reviewer role and tenant.
- `M2.10.02`: Reasoned score amendment preserves immutable original in DB, but actual UI marks entry, double-commit, rejection, post-final cross-role notifications and appeal require full end-to-end validation.
- `M2.10.03`: Original selected legacy mocked scoring lifecycle FAILED because query-only test double lacks required transaction interface. A different real PGlite scoring workflow PASSED 1/1, but that does not repair the old test or prove all next-owner case routing. Keep original FAIL pending harness modernization and full human review.
- `M2.10.04`: Selected real scoring service conflict blocks reviewer and routes to Admin with retained draft; stale reviewer second-tab, tenant transfer, independent reassignment, owner notification and permission changes remain to test.
- `M2.10.05`: Live browser calibrated expiry/FAILED gate blocked Verifier and showed Worker hold; full expiry clock controls, shift/calibration race, separate Admin actor, retries and accessibility signoff pending.

**All cases remain NOT TECH FULLY VERIFIED** pending complete cross-role/UI/adversarial/adapter and independent reviewer signoff.

## Genuine code/test-harness drift — do not promote original selected FAIL

Original `M2.10.03` source test `tests/platform/written-scoring-end-to-end-runtime.test.mjs` FAILED because it supplies a **query-only fake database** without `.transaction`, but current `src/lib/scoring/written-scoring-service.ts` requires `.transaction` for publish and other mutations. It executed no valid business state check. **One separate real-PGlite integration check** in `tests/platform/written-scoring-runtime.test.mjs` passed 1/1 for calibrated ownership, marks, draft decision, final persistence and mutation refusal. This is stronger evidence about current product behavior, **not a fix or rerun of the failing legacy mock**. Keep source-case count 4/5 for Batch 034; flag test-harness maintenance for later repair and repeat.

- Original failed source log SHA256 `9b56da23b274580e5622d63b76b28be3c8c6efd0c4f4a4945c213d9dd3824ab3`
- Alternative real-database source log SHA256 `73cd0ff25650c3524a84a4e90f83ba7303a19fad88fab4fd702c6b63d447ca82`
