# M1.04.01 — six portal role isolation under forged identity selectors (SCOPED ONLY)

Date 2026-11-11. **Signed QA base:** `7c2ed2ed5ce666f2c5ede4c9e7857e3963c84862` (PR #85 two-parent signed GitHub merge, **22/22 merged-SHA workflows SUCCESS**). Isolated worktree `hseverify-m10401-role-query-20261111`, branch `qa/verify-m10401-role-query-20261111`, V4 audit session `a1cfc4d1-a107-4361-a59a-03842bd9e14e`, cycle `f895cfbee6404354930d0dcb25dcf336`. No unrelated worktrees or production accounts touched.

**FULLY VERIFIED 0/218 | M1.04.01 NOT FULLY_VERIFIED | PENTEST INCOMPLETE | BLOCKED_EXTERNAL at least 10 known | RELEASE NO-GO.** Test execution was controlled local Next.js/real Chromium/PGlite using synthetic seeded accounts, not final exact-SHA staging, production HTTPS or real providers.

## What was tested

- Existing `tests/browser/authentication-boundaries-e2e.browser.test.mjs`: real sign-in UI for **Worker, Company, Assessor, Verifier, Admin, Root**. Rejected 30 wrong-role credential/MFA portal sign-ins, wrong password and five privileged bad MFA; successful correct-role sign-in. Existing 30 direct foreign dashboard URLs denied while keeping legitimate session fixed to original portal.
- **New actual 30 forged-request cases (6 sessions × 5 foreign dashboards)**: with valid original-role session cookie, send a real Chromium navigation to foreign portal `/dashboard` that includes attacker-chosen `role`, `activeRole`, `portalRole`, `accountId`, `tenantId`, `membershipId` **query parameters** and `x-hse-role`, `x-hse-active-role`, `x-hse-account-id`, `x-hse-tenant-id`, `x-hse-membership-id` **HTTP request headers**. All 30 redirects led to `/access-denied`; no foreign-role dashboard was rendered, and no HTTP 500 was returned. Page visibly displayed Access denied; no session elevation occurred.
- PGlite persistence: all six accounts hold exactly the correct original-role sessions, all revoked only by their own subsequent **Sign Out**; rejected credentials create no session. Audit checks require denial for every attempted foreign role, actor account and original active role and correct associated session ID, including repeated forged requests. Real **Exit Portal** preserves session, Sign Out Cancel preserves, confirmed Sign Out revokes and prevents dashboard.
- `node --test tests/browser/authentication-boundaries-e2e.browser.test.mjs`: **1/1 PASS, exit 0** after correcting a *test-only* audit count assumption. Evidence `.autopilot/artifacts/M10401_SIX_ROLE_FORGED_SELECTOR_CHROMIUM_GREEN_20261111.log`.
- `node --test tests/platform/authorization-final-isolation-suite.test.mjs`: **3/3 PASS, exit 0**, validates protected commands fixed to portal role, cross-tenant/malformed IDs nonenumerating, and revoked/permission lifecycle races recheck authoritative DB. These native checks do **not** replace real HTTP API BOLA coverage. Evidence `.autopilot/artifacts/M10401_FINAL_TENANT_AUTH_NATIVE3_GREEN_20261111.log`.
- Prior same signed source staff-role journey real Chromium `tests/browser/staff-role-complete-journey.browser.test.mjs` **1/1 PASS** on predecessor isolated source, not rerun on new test SHA. Root invited staff and MFA-bound workspaces; author/reviewer approvals and immutable versions. This is independent context, not full M1.04.01 signoff.

## Failed first run: test assertion, not application vulnerability

The initial expanded test visibly denied **all 30/30 forged requests** but failed at an invented exact audit-count assertion: for Worker there were **20** rows where the test expected **10**. Protected layout rendering may emit multiple audit records per navigation. No contract promises one audit row per browser navigation. The test now checks that **every foreign target has at least two denial records**, with exact original actor, role, and session binding, without mislabeling duplicate audit records as a security bypass. Re-run **1/1 PASS**. Initial reproducible log `.autopilot/artifacts/M10401_FIRST_CHROMIUM_AUDIT_ASSERT_RED_20261111.log`; coverage-only signed-HEAD test absence log `.autopilot/artifacts/M10401_FORGED_SELECTOR_COVERAGE_RED_20261111.log`. No production code was changed; audit duplication can be reviewed separately for operational noise.

- `npm run typecheck` **PASS**, `npm run lint` **exit 0 / 0 errors / 9 inherited warnings**, `node --check` browser JS PASS, PyYAML parse two exact-SHA jobs PASS, `git diff --check` PASS. Raw `.autopilot/artifacts/M10401_TYPECHECK_GREEN_20261111.log` and `.autopilot/artifacts/M10401_LINT_EXIT0_WARN9_20261111.log`.

## CI and final limitations

A new two-job exact PR-head/merged-SHA GitHub workflow `.github/workflows/m1-04-six-role-portal-query-isolation.yml` runs the real 30 forged browser checks and 3 native tenant security cases with archived evidence. **GitHub CI pending** at initial report writing.

**Still required:** complete actual API/server-action/POST headers and Origin/CSRF tampering, all protected endpoints and cross-tenant/worker record IDs, forms/files/downloads/exports (not only six dashboards), privilege-change and session race, HTTPS cookie/provider config, production provider paths, realistic load/restore, exact final staging and owner UAT. 0/218 fully verified; never count this scoped PASS as full acceptance.

## Next

1. Strict TypeScript + ESLint + JS/YAML checks, guarded commit/push only test/workflow/report/TSV/checkpoint and audit in isolated branch. Demand exact PR SHA real browser+native+compliance green, signed two-parent GitHub merge and all **merged SHA** CI green. Protect other worktrees/tests.
2. First unfinished next M1.04.02 **tenant-scoped resources, filters, files and exports**, with real browser/API BOLA between two companies and persisted DB/notification, and broaden M1.04.01 direct protected API checks. Mark real external blockers BLOCKED_EXTERNAL. Keep release **NO-GO**.
