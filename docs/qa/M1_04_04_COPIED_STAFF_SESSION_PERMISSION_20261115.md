# M1.04.04 — Company staff copied browser session live permission/membership revalidation

**2026-11-15 — SCOPED actual real-browser verification only. Original frozen M1.04.04 remains NOT_FULLY_VERIFIED. Release NO-GO.**

## Exact reference and prior green cases reused

- Signed QA two-parent PR #118 merged SHA `0e9eee20d4daa36f7258bf13a127423ad5732e5f`: **32/32 exact merged-SHA GitHub Actions workflows SUCCESS**. The existing single source-test identity `tests/browser/company-complete-journey.browser.test.mjs` was already a direct exact-CI green M1.04.04 case; original role, staff, tenant and permission results were reused in place. This unit adds scope to the SAME test, not a second passing source case.
- Uncovered attack branch: independent second browser with **a copied existing HTTP-only staff cookie** might retain cached grant and export Worker CSV after the owner removed or suspended membership. Deterministic source coverage test initially RED exit1 because required distinct copied-cookie assertion was absent; this was **not a product exploit**, no user data touched. Raw source-gap log `.autopilot/artifacts/M10404_COPIED_STAFF_SOURCE_COVERAGE_RED.log`, SHA256 `223aaa9b5eed19480f281198d9bb39966b132dcc2cfda204875a5746cd25ebf9`.

## Genuine 390/320 Chromium and authoritative persistence

- Original Company real browser sign-in, staff invitation, real TOTP enrollment and Company owner grant lifecycle performed against isolated synthetic PGlite. Constructed a **separate 320px Playwright browser context from the signed-in staff `storageState()`**, with no second login. Its authenticated request context used the genuine copied session cookie.
- With current `company.workforce.manage` permission, original + copied contexts both retrieved `/api/company/workers/export` HTTP200 and verified CSV header.
- After owner removed workforce permission, both contexts lost export; copied second browser denied plain GET and forged `x-hse-active-role: root`, `x-hse-account-id`, and `x-hse-tenant-id` requests, with **no CSV worker rows**. After owner explicitly regranted permission without a new staff login, both original and copied contexts again retrieved authorized CSV.
- Once owner **suspended** the Team membership, copied and original signed sessions were denied; later after owner reactivated and finally **revoked** the membership, the copied session remained denied, no Worker CSV leak. Existing staff UI dashboard/team access redirects, role escalation/forged owner grants, archived site/department and own sessions all passed.
- Existing full Company browser workflow continued through assurance orders, policy, refunds/capture/idempotency, Worker and Company data, and persisted role/membership/audit/billing-state assertions successfully.
- Full original existing real Chromium test `node --test --test-concurrency=1 tests/browser/company-complete-journey.browser.test.mjs` **1/1 PASS**, exit0, ~132.8s. Raw log `.autopilot/artifacts/M10404_COPIED_STAFF_ACTUAL_CHROMIUM_20261115.log`; SHA256 `a945cb85514e6f50cd5e98feb6bc5e50898ff714c894f36c8cc800da07b06931`. Key genuine probe marker `M10404_COPIED_STAFF_SESSION_LIVE_PERMISSION_DENIED` visible. No code/product fix needed.

## Frozen original evidence and next step

- Strict original FULLY VERIFIED **0/218**, LEFT218, **NO-GO**. Historical previously matched 1,399/1,572, 173 with no prior matched pass; old scoped216/218 **NOT FULL**. Planned **693/4,975 PARTIAL +55 UNCERTAIN +4,227 UNLINKED**, FINAL0/4,975. PENTEST incomplete (2,008 preliminary candidates independently verified UNKNOWN), HIGH/CRITICAL UNKNOWN; 10 known external blockers. All current local tests are scoped and do not certify final stage.
- Isolated worktree `hseverify-m10404-copied-staff-cookie-20261115`, branch `qa/m10404-copied-staff-cookie-20261115`, QA base SHA `0e9eee20d4daa36f7258bf13a127423ad5732e5f`, Autopilot V4 ACTIVE audit session `dd73543f-1e31-4a66-9561-d079243e5168`, cycle `1e8b2e1bab0742d388baeefe457a6362`. Only existing browser case, original evidence and governance changed; no provider/production traffic.
- **NEXT:** exact original 218/4,975 integrity/source-case index/legacy/action queue audit; guarded commit+push PR; exact PR-head full Company Chromium and native authorization, current 218 fail-closed ledger with 4 source verifiers, 4975 and Autopilot; merge only all head green; independently verify merged QA SHA 32+ workflow results. Then original frozen M1.05.01 if M1.04.04 final-stage/real providers/independent pentest/owner UAT are externally blocked, while retaining M1.04.04 NOT_FULLY_VERIFIED. No release ready claim.


**Original integrity gate log:** `.autopilot/artifacts/M10404_ORIGINAL_218_4975_ALL_ENG_GATES_20261115.log`, SHA256 `642154265b20b4ca8abec25a3bd5d7b4fa22dcb68dda1f7dd6b843475c836c71`; all current 218 exact ledger, old216 legacy, source test SHA, 4975 and native engineering integrity suites exited 0. No final release attestation.
