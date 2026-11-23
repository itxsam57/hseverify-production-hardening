# ZERO-012 — Organization and Team technical evidence

**1 of at most five original related workflow units attempted.** Selected source case results: **1 PASS**, **0 FAIL/UNPROVEN**. **0 newly TECH FULLY VERIFIED.**

Source application SHA: `7ff30ea140a5145e5d5ba761f7c7aef24c895269`. QA tooling SHA at run: `3b4e70c4b39f09bb1cbcac137721e1c2fd998d76`. Original app/prod/staging were not modified. Local synthetic fixtures; real browser cases where indicated.

| Original scenario | Selected source test | Outcome |
|---|---|---|
| `M1.09.06` | M1.09.06 actual Chromium Owner removes Admin live grant while stale Admin Manager and invitation forms cannot delegate it | SCOPED PASS |

## Three discipline reviews — not independent certification

**ENGINEER:** Selected checks performed in the actual source application and/or isolated DB, with real input/role assertions where present. All selected checks passed. Complete route inventory, cross-role connected effects, maintainability and responsive UI are not fully audited.

**CYBERSECURITY:** Selected negative, permission, file or race assertions were exercised only to the extent verified in each case source. No entire attack-surface, penetration-scope, independent replay, security race, provider contract or load assurance is implied. High/critical vulnerability count for full app: **UNKNOWN**.

**REVIEWER:** Original ID, title, selected test log and result accounted for, but full original Masterplan workflow/visual/code independent signoff has **not** been completed. No claim of accredited third-party review.

## Outstanding per-case test scope

- `M1.09.06`: Remaining complete role/UI/security/adapter-contract/reviewer evidence to be gathered.

## Raw test evidence (workstation-private; SHA256)

- `M1.09.06`: `private-workstation:artifacts/agency-zero/ZERO-012/M1.09.06.log` — SHA256 `ff787edcbb7a4660d28c2bbe68e3a9a887dd81e6d3f14c91724622b01fd97869`, selected run exit 0, TAP {'tests': 1, 'pass': 1, 'fail': 0, 'skipped': 0}.

## Exact continuation

This batch is recorded as attempted/incomplete, **not confirmed**. Save raw evidence; do not repeat passed scoped tests without a changed candidate or reason. Continue next separate related batch while the unfinished security and independent reviews stay in the original unresolved queue.

Recorded UTC: 2026-11-22T18:34:55.313054+00:00

## Extra real PostgreSQL16 cybersecurity test (one additional check, not one additional scenario)

**PASS 1/1**: `tests/platform/company-organization-team.test.mjs` — `M1.09.06 actual PostgreSQL16 Owner revoked Admin live grant cannot be delegated under overlapping transactions`. Dedicated disposable localhost PG16 cluster on random port; started/stopped verified, not shared staging. It checks pre-revocation authorized invite, transaction serialization on revocation, denial of stale Admin permission/invite/owner-grant/cross-tenant, correct receiving Manager permissions, exact audit events, and zero forged invitation rows.

**ENGINEER:** Chromium real browser 1/1 PASS; PG16 race 1/1 PASS; code spot-check confirmed tenant-scoped `runTenantScopedCommand`, `liveActor` SQL row lock, `livePermissions`, `assertGrantAuthority`, and access-revision CAS on Manager update. No product source modified. This is scoped functional and code review, not all feature-wide source-quality proof.

**CYBERSECURITY:** Targeted dynamic negative authorization and concurrent stale-grant tests PASS; no permission escalation observed in selected paths. A full independent penetration test against all applicable endpoints/role/tenant permutations remains outstanding; whole-system high/critical count UNKNOWN.

**REVIEWER:** Source case/logs and DB effects reviewed within one AI session; no separate independent reviewer/visual signoff. **TECH FULLY VERIFIED: NO.**

**Adapter contract:** NOT APPLICABLE for these internal Team permission transitions. Email/SMS invitation delivery adapters retain their independent planned test gate.

- `M1.09.06.security-PG16.log` SHA256 `178d3a037ae573db8f8a6e01cb5d1bde7cd4c81ee4c6a50383ac548e8d378588`
- `PG16-bootstrap.log` SHA256 `a5b672257363985ae7798b513177d66a0e095ee101663aa5e9ae3c6a049c126f`
