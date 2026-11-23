# ZERO-013 — Invitations and employment links technical evidence

**5 of at most five original related workflow units attempted.** Selected source case results: **5 PASS**, **0 FAIL/UNPROVEN**. **0 newly TECH FULLY VERIFIED.**

Source application SHA: `7ff30ea140a5145e5d5ba761f7c7aef24c895269`. QA tooling SHA at run: `e2d83553a3f4645cddd290b2345459a4bce8f9f0`. Original app/prod/staging were not modified. Local synthetic fixtures; real browser cases where indicated.

| Original scenario | Selected source test | Outcome |
|---|---|---|
| `M1.10.01` | M1.10.01 real Chromium Company Worker invitation acceptance resend revocation expiry wrong role email and replay | SCOPED PASS |
| `M1.10.02` | M1.10.02 real Chromium bulk CSV quoted valid, malformed, duplicate, empty-first-cell, retry and Worker receiver persist per row | SCOPED PASS |
| `M1.10.03` | M1.10.03 actual PostgreSQL16 Worker last-slot race enforces code expiry usage/default Site Department and immutable cross-role audit | SCOPED PASS |
| `M1.10.04` | M1.10 dual-employer browser protects each tenant while preserving Worker history | SCOPED PASS |
| `M1.10.05` | Company ends active Worker relationship while Worker retains identity and prior Company history | SCOPED PASS |

## Three discipline reviews — not independent certification

**ENGINEER:** Selected checks performed in the actual source application and/or isolated DB, with real input/role assertions where present. All selected checks passed. Complete route inventory, cross-role connected effects, maintainability and responsive UI are not fully audited.

**CYBERSECURITY:** Selected negative, permission, file or race assertions were exercised only to the extent verified in each case source. No entire attack-surface, penetration-scope, independent replay, security race, provider contract or load assurance is implied. High/critical vulnerability count for full app: **UNKNOWN**.

**REVIEWER:** Original ID, title, selected test log and result accounted for, but full original Masterplan workflow/visual/code independent signoff has **not** been completed. No claim of accredited third-party review.

## Outstanding per-case test scope

- `M1.10.01`: Remaining complete role/UI/security/adapter-contract/reviewer evidence to be gathered.
- `M1.10.02`: Remaining complete role/UI/security/adapter-contract/reviewer evidence to be gathered.
- `M1.10.03`: Remaining complete role/UI/security/adapter-contract/reviewer evidence to be gathered.
- `M1.10.04`: Remaining complete role/UI/security/adapter-contract/reviewer evidence to be gathered.
- `M1.10.05`: Remaining complete role/UI/security/adapter-contract/reviewer evidence to be gathered.

## Raw test evidence (workstation-private; SHA256)

- `M1.10.01`: `private-workstation:artifacts/agency-zero/ZERO-013/M1.10.01.log` — SHA256 `a71504e0c228f442592db5fb6bdfb65869382f990883b97789aa5f75a4479382`, selected run exit 0, TAP {'tests': 1, 'pass': 1, 'fail': 0, 'skipped': 0}.
- `M1.10.02`: `private-workstation:artifacts/agency-zero/ZERO-013/M1.10.02.log` — SHA256 `11cb64d74befc11d3083487b54c38a5080c35bc629510d48681ca050ba2781b7`, selected run exit 0, TAP {'tests': 1, 'pass': 1, 'fail': 0, 'skipped': 0}.
- `M1.10.03`: `private-workstation:artifacts/agency-zero/ZERO-013/M1.10.03.log` — SHA256 `60e7c85b6a8054552476953f7da158e4b6746deb24798d674267aea3366f40f5`, selected run exit 0, TAP {'tests': 1, 'pass': 1, 'fail': 0, 'skipped': 0}.
- `M1.10.04`: `private-workstation:artifacts/agency-zero/ZERO-013/M1.10.04.log` — SHA256 `95a1ec440d807009e46a011dd4fdaa3b1809b5b64b6d0a3004c4729aee381e13`, selected run exit 0, TAP {'tests': 1, 'pass': 1, 'fail': 0, 'skipped': 0}.
- `M1.10.05`: `private-workstation:artifacts/agency-zero/ZERO-013/M1.10.05.log` — SHA256 `41dc85af108770a9d5fad2f666337e8356769cf63d95077d432ccbc3c4c18cb2`, selected run exit 0, TAP {'tests': 1, 'pass': 1, 'fail': 0, 'skipped': 0}.

## Exact continuation

This batch is recorded as attempted/incomplete, **not confirmed**. Save raw evidence; do not repeat passed scoped tests without a changed candidate or reason. Continue next separate related batch while the unfinished security and independent reviews stay in the original unresolved queue.

Recorded UTC: 2026-11-22T18:42:32.381818+00:00

## Isolated PostgreSQL16 proof

M1.10.03 selected real PostgreSQL16 test passed last-slot registration-code race, expiry, usage limit, Site/Department scope, and Worker/Company audit. Dedicated database started and stopped; bootstrap log SHA256 `3bbbe44123ffe8d57868428fe7544e8c0e056ccf18739f8842f4d5eddfc7658a`.

## Original-Masterplan coverage mismatches: explicit unverified requirements

- `M1.10.04`: The selected dual-employer browser case does NOT explicitly demonstrate a wrong/unlinked Worker accepting another person’s invitation; perform that attack independently.
- `M1.10.05`: Selected relationship ending test does not establish every site/department transfer, invite and Worker recipient variant.

These gaps remain **NOT VERIFIED** even if the selected related source test passed. The 218 numerator is unchanged.

## 2026-11-23 ZERO-R10 source-and-raw-log correction

The earlier *M1.10.04 copied foreign Worker link not demonstrated* scope note is **superseded for that single edge** after exact original source and retained log inspection (not a new execution). The source `tests/browser/company-dual-employer-isolation.browser.test.mjs` actually logs in two distinct Workers, tampers the real hidden linkId to the other Worker's offer, observes denial, has each rightful Worker accept, and validates exact actor-bound PostgreSQL-compatible PGlite DB/audit rows. The frozen ZERO-013 raw `M1.10.04.log` SHA256 `95a1ec440d807009e46a011dd4fdaa3b1809b5b64b6d0a3004c4729aee381e13` includes `ACTUAL_M11004_FORGED_INVITE_BROWSER` and `ACTUAL_M11004_DB`; TAP 1/1 PASS. **No new test or TECH FULL result added.** Other auth/security/reviewer gates remain open. See [AGENCY_ZERO_R10_INVITATION_EVIDENCE_RECONCILIATION.md](AGENCY_ZERO_R10_INVITATION_EVIDENCE_RECONCILIATION.md).
