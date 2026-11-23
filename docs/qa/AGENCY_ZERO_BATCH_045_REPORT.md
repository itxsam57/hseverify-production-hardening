# ZERO-045 — Company Action Centre and directory technical evidence

**5 of at most five original related workflow units attempted.** Selected source case results: **3 PASS**, **2 FAIL/UNPROVEN**. **0 newly TECH FULLY VERIFIED.**

Source application SHA: `7ff30ea140a5145e5d5ba761f7c7aef24c895269`. QA tooling SHA at run: `e87b900993dff7d8ad9e5422e3ea7dc8755aa7f5`. Original app/prod/staging were not modified. Local synthetic fixtures; real browser cases where indicated.

| Original scenario | Selected source test | Outcome |
|---|---|---|
| `M3.04.01` | Company filtered directory preserves status through Next, refresh and Previous | SCOPED PASS |
| `M3.04.02` | M1.10.05 real Chromium Company moves active Worker Site Department, rejects forged unit and Worker receives fresh scoped history | SCOPED PASS |
| `M3.04.03` | tests/platform/company-action-centre-analytics.test.mjs (99.952263ms) | FAIL_OR_UNPROVEN |
| `M3.04.04` | Company owner completes organization, workforce, Team, assurance, policy, report and tenant-scope workflows in Chromium | SCOPED PASS |
| `M3.04.05` | tests/platform/company-action-centre-analytics.test.mjs (103.656367ms) | FAIL_OR_UNPROVEN |

## Three discipline reviews — not independent certification

**ENGINEER:** Selected checks performed in the actual source application and/or isolated DB, with real input/role assertions where present. At least one check failed or could not be proven; triage from raw log required. Complete route inventory, cross-role connected effects, maintainability and responsive UI are not fully audited.

**CYBERSECURITY:** Selected negative, permission, file or race assertions were exercised only to the extent verified in each case source. No entire attack-surface, penetration-scope, independent replay, security race, provider contract or load assurance is implied. High/critical vulnerability count for full app: **UNKNOWN**.

**REVIEWER:** Original ID, title, selected test log and result accounted for, but full original Masterplan workflow/visual/code independent signoff has **not** been completed. No claim of accredited third-party review.

## Outstanding per-case test scope

- `M3.04.01`: No direct older source-case link; discovered related case must be mapped/reviewed. Remaining complete role/UI/security/adapter-contract/reviewer evidence to be gathered.
- `M3.04.02`: No direct older source-case link; discovered related case must be mapped/reviewed. Remaining complete role/UI/security/adapter-contract/reviewer evidence to be gathered.
- `M3.04.03`: No direct older source-case link; discovered related case must be mapped/reviewed. Investigate selected test result FAIL_OR_UNPROVEN without discarding other evidence.
- `M3.04.04`: No direct older source-case link; discovered related case must be mapped/reviewed. Remaining complete role/UI/security/adapter-contract/reviewer evidence to be gathered.
- `M3.04.05`: No direct older source-case link; discovered related case must be mapped/reviewed. Investigate selected test result FAIL_OR_UNPROVEN without discarding other evidence.

## Raw test evidence (workstation-private; SHA256)

- `M3.04.01`: `private-workstation:artifacts/agency-zero/ZERO-045/M3.04.01.log` — SHA256 `77eb1e79f873256e0afe835fdd7b3eb8d68c08410a0d391f3f15ff7fc67922f9`, selected run exit 0, TAP {'tests': 1, 'pass': 1, 'fail': 0, 'skipped': 0}.
- `M3.04.02`: `private-workstation:artifacts/agency-zero/ZERO-045/M3.04.02.log` — SHA256 `e4d11207da1185364112cacd84160505877863a2890394c0db2fd4d11dc0ba89`, selected run exit 0, TAP {'tests': 1, 'pass': 1, 'fail': 0, 'skipped': 0}.
- `M3.04.03`: `private-workstation:artifacts/agency-zero/ZERO-045/M3.04.03.log` — SHA256 `b13467257269473937078605aa37492b7549d7356dc333446d52fb8a84079c48`, selected run exit 1, TAP {'tests': 1, 'pass': 0, 'fail': 1, 'skipped': 0}.
- `M3.04.04`: `private-workstation:artifacts/agency-zero/ZERO-045/M3.04.04.log` — SHA256 `73c8855353bcc19c0d189cd3f8f9baf0eaf321bbf723d73e0ba88f102e5a81a5`, selected run exit 0, TAP {'tests': 1, 'pass': 1, 'fail': 0, 'skipped': 0}.
- `M3.04.05`: `private-workstation:artifacts/agency-zero/ZERO-045/M3.04.05.log` — SHA256 `1288c85ee79a3ffc4489b930ca3980e5068cd7923a74bb47f793e1fd9d1a32f3`, selected run exit 1, TAP {'tests': 1, 'pass': 0, 'fail': 1, 'skipped': 0}.

## Exact continuation

This batch is recorded as attempted/incomplete, **not confirmed**. Save raw evidence; do not repeat passed scoped tests without a changed candidate or reason. Continue next separate related batch while the unfinished security and independent reviews stay in the original unresolved queue.

Recorded UTC: 2026-11-22T20:36:21.486604+00:00

## Exact source test revalidation after a TEST-SETUP-only blocker

The first direct `node --test` invocations could not import the required `HSE_ASSURANCE_ORDER_RUNTIME_DIST`. The official existing runtime compiler was used in an isolated artifact directory; the named source tests now actually executed.

- `M3.04.03` actual selected source: **PASS 1/1**; retest SHA256 `9d23c410f4ded2f26e3862382ef96834be2d83cfdbf0f5ed89051150e220bee7`. The original failed/unexecuted source log remains in the ledger.
- `M3.04.05` actual selected source: **PASS 1/1**; retest SHA256 `375402155552f0193f6146cd020ca8033def6ebaae56be15f3eaa4c5872e3cf9`. The original failed/unexecuted source log remains in the ledger.

No scenario earns TECH FULL. The original setup-result `results.tsv` remains immutable; the cursor is reconciled to current scoped source evidence.

## Full original acceptance requirements NOT proven by selected source checks

- `M3.04.01`: Real Company workforce directory preserves active filters across pagination/refresh. Cross-tenant isolation, mixed-status counts, all role-specific filters, empty state and every pagination boundary remain unverified.
- `M3.04.02`: Real Company Site/Department move rejects forged units and updates Worker receiver. End relationship/relink, all Company Action Centre source deep links and concurrent updates were not tested within this case.
- `M3.04.03`: Real analytics service projects live workflows, approvals, readiness and competency gaps within trusted tenant. Exact next action across each funding/evidence/assessment/interview/decision state and all role recipients remain unverified.
- `M3.04.04`: Full real Company browser journey exercises assignment, invalid/valid snooze and acknowledge plus many tenant controls. Every exact source deep link, no false final completion, external notifications, independent recipient and accessibility signoff remain open.
- `M3.04.05`: Service excludes closed/cancelled work and denies wrong permissions. Real Company readiness/expiry totals over mixed approved/pending/suspended/revoked/expired credentials and across refresh/notifications are not proven.

**ENGINEER:** selected source PASS only. **CYBERSECURITY:** limited targeted checks; whole attack surface, adapters and staging pen still pending. **REVIEWER:** independent original workflow/visual/code acceptance pending. **TECH FULL: NO.**

## R17 exact-SHA scoped Action Centre revisit

M3.04.03/.05 related R17 **four distinct runtime/contract/anonymous Chromium tests SCOPED PASS 4/4**, with no true authenticated Company journey certification, per `AGENCY_ZERO_R17_COMPANY_ACTION_CENTRE_REPORT.md`. Original frozen result counts and previous raw evidence unchanged; 0 TECH FULL.
