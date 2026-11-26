# ZERO-043 — Passport and Living Record technical evidence

**5 of at most five original related workflow units attempted.** Selected source case results: **4 PASS**, **1 FAIL/UNPROVEN**. **0 newly TECH FULLY VERIFIED.**

Source application SHA: `7ff30ea140a5145e5d5ba761f7c7aef24c895269`. QA tooling SHA at run: `e87b900993dff7d8ad9e5422e3ea7dc8755aa7f5`. Original app/prod/staging were not modified. Local synthetic fixtures; real browser cases where indicated.

| Original scenario | Selected source test | Outcome |
|---|---|---|
| `M3.02.01` | Digital Passport projects qualifications, competencies, restrictions, expiry, reassessment and history | SCOPED PASS |
| `M3.02.02` | Actual issued Living Record is expired in Passport and scoped-share projections while stored history stays valid | SCOPED PASS |
| `M3.02.03` | accepted credential appeal preserves reasoned review history and appends a Living Record reassessment version | SCOPED PASS |
| `M3.02.04` | Actual appeal renew after expiry produces a distinct configured renewal without erasing original signed history | SCOPED PASS |
| `M3.02.05` | tests/platform/company-worker-invitations.test.mjs | FAIL_OR_UNPROVEN |

## Three discipline reviews — not independent certification

**ENGINEER:** Selected checks performed in the actual source application and/or isolated DB, with real input/role assertions where present. At least one check failed or could not be proven; triage from raw log required. Complete route inventory, cross-role connected effects, maintainability and responsive UI are not fully audited.

**CYBERSECURITY:** Selected negative, permission, file or race assertions were exercised only to the extent verified in each case source. No entire attack-surface, penetration-scope, independent replay, security race, provider contract or load assurance is implied. High/critical vulnerability count for full app: **UNKNOWN**.

**REVIEWER:** Original ID, title, selected test log and result accounted for, but full original Masterplan workflow/visual/code independent signoff has **not** been completed. No claim of accredited third-party review.

## Outstanding per-case test scope

- `M3.02.01`: No direct older source-case link; discovered related case must be mapped/reviewed. Remaining complete role/UI/security/adapter-contract/reviewer evidence to be gathered.
- `M3.02.02`: No direct older source-case link; discovered related case must be mapped/reviewed. Remaining complete role/UI/security/adapter-contract/reviewer evidence to be gathered.
- `M3.02.03`: No direct older source-case link; discovered related case must be mapped/reviewed. Remaining complete role/UI/security/adapter-contract/reviewer evidence to be gathered.
- `M3.02.04`: No direct older source-case link; discovered related case must be mapped/reviewed. Remaining complete role/UI/security/adapter-contract/reviewer evidence to be gathered.
- `M3.02.05`: No direct older source-case link; discovered related case must be mapped/reviewed. Investigate selected test result FAIL_OR_UNPROVEN without discarding other evidence.

## Raw test evidence (workstation-private; SHA256)

- `M3.02.01`: `private-workstation:artifacts/agency-zero/ZERO-043/M3.02.01.log` — SHA256 `4b4526800adeaa2fea4cd76a2829dfbd80a8c10e4e543daba1f3fc9e31d7821a`, selected run exit 0, TAP {'tests': 1, 'pass': 1, 'fail': 0, 'skipped': 0}.
- `M3.02.02`: `private-workstation:artifacts/agency-zero/ZERO-043/M3.02.02.log` — SHA256 `7cf5dc41ef291ddeb8bacb8a99c9417da46712f3e557141a2322e0a284cd6518`, selected run exit 0, TAP {'tests': 1, 'pass': 1, 'fail': 0, 'skipped': 0}.
- `M3.02.03`: `private-workstation:artifacts/agency-zero/ZERO-043/M3.02.03.log` — SHA256 `744d76950d1f3de9c8e744e412f5624514050355b9a47bea9a3d47fdd624da9d`, selected run exit 0, TAP {'tests': 1, 'pass': 1, 'fail': 0, 'skipped': 0}.
- `M3.02.04`: `private-workstation:artifacts/agency-zero/ZERO-043/M3.02.04.log` — SHA256 `a6a949cfd61717af969e1b8b95ccec264cb7193577a23dac118f7c0ac3d90d3c`, selected run exit 0, TAP {'tests': 1, 'pass': 1, 'fail': 0, 'skipped': 0}.
- `M3.02.05`: `private-workstation:artifacts/agency-zero/ZERO-043/M3.02.05.log` — SHA256 `099446eb991aba8ca3f73ee0ead3dc095bfdf1e31767d534279c00ae5b963c3a`, selected run exit 0, TAP {'tests': 1, 'pass': 1, 'fail': 0, 'skipped': 0}.

## Exact continuation

This batch is recorded as attempted/incomplete, **not confirmed**. Save raw evidence; do not repeat passed scoped tests without a changed candidate or reason. Continue next separate related batch while the unfinished security and independent reviews stay in the original unresolved queue.

Recorded UTC: 2026-11-22T20:32:11.708017+00:00

## Exact source test revalidation after a TEST-SETUP-only blocker

The first `node --test` run re-entered the wrapper and printed a misleading file-level PASS without running the selected test. The approved `scripts/run-company-worker-invitation-tests.mjs` compiled its required runtime and then ran the **actual named test**.

- `M3.02.05` actual selected source: **PASS 1/1**; retest SHA256 `f5a7326d179bfca5cb231f656fd67ebd8305318620e779142d6769318b589320`. The original failed/unexecuted source log remains in the ledger.

No scenario earns TECH FULL. The original setup-result `results.tsv` remains immutable; the cursor is reconciled to current scoped source evidence.

## Full original acceptance requirements NOT proven by selected source checks

- `M3.02.01`: Digital Passport domain projects qualification, competency, restrictions and history. The Worker/Company rendered interface must still prove verified qualification is visually and semantically distinct from independently assessed competency.
- `M3.02.02`: Issued credential expiry appears in Passport and scoped-share projections without erasing stored history. All live condition/restriction/suspension/revocation branches and prior version UI remain unverified.
- `M3.02.03`: Accepted appeal appends reasoned reassessment Living Record history. Separate suspension, revocation, denial/replacement outcomes and all consumers retaining originals are not shown by this test.
- `M3.02.04`: Expired credential renewal produces a distinct valid version while preserving original signed history. Worker download/public QR/current Company share consistency and renewal races remain unverified.
- `M3.02.05`: The actual Company transfer-after-termination service retained Worker history and required new consent. It did not prove permanent Worker ID, question exposure, identity data, or all browser/Company scope projections remain unchanged.

**ENGINEER:** selected source PASS only. **CYBERSECURITY:** limited targeted checks; whole attack surface, adapters and staging pen still pending. **REVIEWER:** independent original workflow/visual/code acceptance pending. **TECH FULL: NO.**
