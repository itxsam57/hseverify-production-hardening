# M1.04.01 — real privileged Server Action POST cross-portal replay

**2026-11-15 — SCOPED engineering evidence ONLY. Frozen M1.04.01 remains NOT_FULLY_VERIFIED; release NO-GO.**

## Provenance and original evidence reused

- Signed QA base: `2139bbdb2020d10e7f90f3ac91bbf54f029e6114` (PR #115 merged). **36/36 exact-merged-SHA CI workflows SUCCESS**; no protected final stage or owner UAT certification.
- Existing actual six-role GET/URL/header selector browser test, `tests/browser/authentication-boundaries-e2e.browser.test.mjs`, covered **30 cross-portal role pairs**, denial UI, session/account/tenant query and `x-hse-*` header spoofing, and DB audit. Existing signed QA CI passes reused without rerunning locally. Existing native `tests/platform/authorization-final-isolation-suite.test.mjs` covers privileged role/tenant commands and permission races.
- Missing specific attack before this unit: replay an actual **Next Server Action POST** captured from a privileged form using a **different role's authenticated browser context**, not another GET.

## Test, results and defensible limits

- Added one named test to `tests/browser/m10401-crossportal-server-action.browser.test.mjs`, isolated synthetic PGlite migration and seeded six real portal logins, real Playwright Chromium, mobile 320px foreign browsers / 390px Admin browser, genuine Next-generated action ID and POST body (534 bytes). No shared production or provider data.
- The first run failed **only the test locator**: two `Title` form inputs conflicted. A form-scoped label selector fixed it; no privileged POST was sent in that initial failed setup.
- **Final local run: 1/1 PASS**, exit 0, ~40.2 seconds. Command: `node --test tests/browser/m10401-crossportal-server-action.browser.test.mjs`.
- Logged, authenticated **Worker, Company, Assessor, Verifier, and Root** each replayed the *real captured Admin create-framework Server Action* with forged `role=admin`, `activeRole=admin`, and `x-hse-role/account` selectors. All 5 returned HTTP 200 Next-RSC with **`x-action-redirect: /access-denied;push`**; no private draft leak in response and no framework creation. Signed-out same Server Action replay redirected to `/admin/login?reason=session-required;push`.
- Authorized Admin submitted the real browser form successfully; `/admin/frameworks?status=framework-created` and the success message appeared. DB showed exactly **1** framework created by the Admin account with the authorized title. DB showed **5 actor-bound `access_denied` security events** with the correct foreign role, `expectedRole=admin`, `permission=platform.operations.manage` and `reason=role_mismatch`; no foreign/anonymous write.
- Raw current-worktree log: `.autopilot/artifacts/M10401_CROSS_PORTAL_REAL_NEXT_ACTION_POST_RERUN_20261115.log`; SHA256 **`d288960ed1e72ddfee23913221727201b41d8cb1f4e7706ac5bb0d0e11acf6d5`**. CI workflow `.github/workflows/m1-04-six-role-portal-query-isolation.yml` extended to execute this test at the PR-head and merged QA SHA and upload the raw log.
- No application source change was required for this negative test. This is **one Admin-target action with five foreign role post replays**, **not proof of every possible endpoint/action**. Final protected staging, all remaining API/role/tenant abuse probes, independent pentest, provider acceptance, realistic load/restore and Owner UAT are outstanding.

## Canonical release counters and handoff

- FULLY VERIFIED **0/218**, 218 left; original old 216 scoped NOT release passes.
- Current historical prior-match evidence after reindex: **1,398/1,572** (174 with no prior-reference green match). **Four previously uncredited M1.03.08 PostgreSQL cases** now matched clean pre-existing logs from the sibling historic worktree; they were **not rerun** in this M1.04.01 unit. This newly added M1.04.01 case is deliberately `NO_PASS_LOG_EVIDENCE` in the *prior-source* index until current source/CI references are attested, despite this separately hashed real local PASS.
- Planned slots remain **693/4,975 historical PARTIAL**, **55 UNCERTAIN**, **4,227 UNLINKED**, **FINAL 0/4,975**.
- PENTEST **INCOMPLETE** (2,008 preliminary attack-family candidates, independent completion count UNKNOWN); HIGH/CRITICAL unknown; **10 known external blockers**.
- Isolated branch `qa/m10401-crossportal-server-action-20261115`, base QA SHA `2139bbdb2020d10e7f90f3ac91bbf54f029e6114`. Autopilot V4 active session `da03483d-c29e-4f88-8026-1fed11336dd3`, cycle `61bcf8018acf4f3380d50e3bce329134`. Product final SHA attestation **not available**.
- **NEXT:** Guarded commit/push, PR against QA, exact PR-head and merged-SHA 218/4975, Autopilot, real Chrome Server Action and native authorization CI. Only after complete exact head+merge green, resume M1.04.01 remaining role-target mutation actions or move to first actionable M1.04.02 with final-stage blockers retained; no FULL status until complete final stage and owner UAT.


**Original ledger engineering gate:** all strict index/legacy/scenario/4,975 verify scripts, original source evidence and current-release 218 native tests exited **0**; raw `.autopilot/artifacts/M10401_ALL_ORIGINAL_218_4975_INTEGRITY_20261115.log`, SHA256 `6ec96364959345e1ef5a14d532736fe38b60f7d94e87502bef8cce9e2b54e33c`. These gates do not certify any 4,975 final slots.
