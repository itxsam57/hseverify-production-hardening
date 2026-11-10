# M1.02.02 — exact QA source six-role header/search/bell/account/Help/Exit controls

**2026-11-10 · SCOPED LOCAL TEST PASS · M1.02.02 NOT_FULLY_VERIFIED · RELEASE NO-GO · FULLY VERIFIED 0/218.**

Tested source SHA: `7e18f4d692a18001e1a7d729c3ffd720d6cee1e2`, isolated worktree `hseverify-m10202-header-20261110`, branch `qa/verify-m10202-header-20261110`. This source is the PR #71 test commit incorporated into the signed active QA merge `4b6f683a7be6b9e273b9df91c5f75d72270bb73a`; the M1.02.02 enhancements and new CI have **not** yet been retested/merged at a later exact SHA. All local tests use controlled synthetic users, actual local Next/Chromium/PGlite, not protected final staging or real providers.

## Actual controls and receiving states

- **All six role Help/account menus:** existing real Chromium test for Worker, Company, Assessor, Verifier, Admin and Root passed. Expanded retest then **passed at 1440, 390 and 320px**: click actual account-menu Help → Contact form → return without ending session; open Security and Language: English (link) → verified English-only `#interface-language` section and `html[lang=en]` → return dashboard; open Active Sessions → `/account/sessions` → return dashboard with same role/session. This is **informational English-only language support**, not proof of a multilingual selector.
- **Exit versus Sign Out:** full real Chromium six-role authentication test passed wrong role/password and MFA rejections, cross-portal denial, Exit Portal retains session, confirmed Sign Out revokes current session and records authoritative DB/auth security outcomes.
- **Notification bell:** full real Chromium six-role test passed actual creation from the notification center, bell open, role-scoped target/deep link, Mark Read, Mark All Read, refresh persistence and authoritative PGlite/audit. Test asserts **24 per-role-notification records and 24 immutable read audit events** across six roles. No real external provider notification delivery claimed.
- **Responsive role menus:** actual Chromium six role mobile navigation at **320 and 390px**, desktop sidebar at **1280px**, 44px touch targets, panel visibility and zero navigation overflow, no page errors; controlled local screenshots retained in ignored artifacts.
- **Header search (six actual browsers):** Worker assessment/application search, Company workforce/pagination, Assessor assigned interview search, Verifier assigned review search, Admin submitted company verification queue search, Root invitation search including records beyond 25. Tests include actual query, expected target, pagination or stale/revoked authority where applicable. All **6/6 passed**.
- **Security scope:** unauthorized role/tenant routes, invalid credentials, revoked/expired sessions, role-bound notification routing and immutable audit tested to the extent in the referenced suites. These are **targeted** penetration/authorization regressions, not an exhaustive staged endpoint matrix.

## Result receipts

Initial four core Chromium groups **4/4 PASS**: `portal-help.browser.test.mjs`, `authentication-boundaries-e2e.browser.test.mjs`, `all-role-notification-workflow.browser.test.mjs`, `portal-navigation-responsive.browser.test.mjs`. Six search suites **6/6 PASS** in worker/company/assessor/verifier/admin/root order. Expanded Help/Language/Active Sessions at 320/390/1440 **1/1 PASS**. **11 passing browser executions of 10 distinct suites**. Real command/exit receipt: `docs/qa/evidence/M1_02_02_QA7E18_LOCAL_RESULTS.tsv`; full `.autopilot/artifacts/M10202_*.log` in isolated worktree. Strict TypeScript and ESLint exit0 (9 inherited warnings); new CI YAML parsed successfully.

**Baseline RED → GREEN was test coverage, not an app exploit:** original `portal-help.browser.test.mjs` lacked 320px and actual language/Active Sessions click. Deterministic source check against original commit exits 1 (`M10202_HEADER_COVERAGE_BASELINE_RED.log`); updated test source check and full real Chromium 320px action retest PASS (`M10202_HEADER_COVERAGE_GREEN.log`). Do not mistake this baseline coverage gap for a reproduced application security breach.

Dedicated `.github/workflows/m1-02-header-controls.yml` launches two separate exact-SHA GitHub-hosted Chromium jobs: full core header actions/bell/Help/auth and six search flows; persists actual run logs with SHA even on CI failure. **GitHub workflow and merged-SHA checks require real green evidence before completion.**

## Still mandatory for M1.02.02 and the 218 ledger

- Actual **final protected staging** with real secrets/databases/providers, deployed production hostname/TLS and final matching release SHA; authentic notification/provider delivery (not synthetic fixture).
- Complete authenticated role/tenant/API abuse, retry/race/expiry/denial/restore across all header, search and notification workflows on same staged configuration; keyboard/a11y/320/390/desktop across every critical page/dialog; realistic load/incident/rollback and Owner UAT.
- Active QA branch was checked `protected=false` and no rulesets returned (2026-11-10). Unprotected QA direct-push remains a governance blocker until an approved branch protection policy is configured, without disrupting other in-flight worktrees.

**Next first:** guarded commit of expanded browser/CI/evidence; rerun original 10 distinct browser suites on exact committed SHA, verify GitHub two-job Chromium workflow and other CI; inspect signed QA merge and current exact release ledger. Proceed to M1.02.03 empty/loading/validation/denial/error/retry/success scenario pages after integration. NEVER promote this scope to full 218 release certification on local tests alone.
