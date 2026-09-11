# M1.04 Subunit 5 — Merged Pending Owner Closure

## Status

**IMPLEMENTATION MERGED — AUTOMATED PASS — OWNER CLOSURE PENDING**

M1.04 remains IN PROGRESS. M1.05 remains blocked.

## Exact implementation evidence

- Pull request: `#34`
- Validated branch head: `a4634d10048315923b5c3cae65e1d6f88ededbe8`
- Validated PR merge candidate: `b8312e3d46cf35fc469fc39ffe6a2190ded44b21`
- PR workflow run: `31069538170`
- PR job: `92514406257`
- PR evidence artifact: `8955146532`
- Merge commit: `4329a591dfa7d1e7c4fca3feb5dd33c873984574`
- Merged-main workflow run: `31069783616`
- Merged-main job: `92515107222`
- Merged-main result: **PASS**

## Automated acceptance evidence

- Six-role portal matrix: 6 own-role allows and 30 cross-role denials — PASS.
- Eleven accepted protected-route signed-out pre-render redirects — PASS.
- Cross-tenant, missing and malformed identifier non-enumeration for find/update/delete — PASS.
- Trusted tenant/membership/account/session mismatch denial — PASS.
- Session/account/tenant/membership/active-role/membership-role/permission race revalidation — PASS.
- Complete `0006` then `0005` rollback, base-data preservation and clean reapplication — PASS.
- Disposable and persistent close/reopen PGlite determinism — PASS.
- TypeScript, lint, development runtime, application database runtime, production build, preview and release evidence — PASS.
- Focused generated manual handoff — PASS.

## Required owner closure

Run only `docs/testing/M1_04_FINAL_ACCEPTANCE_HARD_TEST.md`:

1. signed-out `/worker/profile` redirects to `/worker/login?reason=session-required` before protected rendering;
2. Company login/TOTP succeeds;
3. Company direct navigation to `/worker/profile` shows **Access Denied** and returning to the active Company portal preserves the session;
4. normal shutdown and clean synchronized Git state pass.

The other ten signed-out routes and twenty-nine cross-role combinations are automated. Do not repeat the accepted Company CRUD workflow.

## Acceptance rule

Do not mark subunit 5 or M1.04 DONE until the owner reports the focused closure PASS and the final acceptance documentation is merged and synchronized.
