# HSE Verify — M2.13.04 exact-source evidence (2026-11-07)

**Base:** `qa/masterplan-release-20261016` at `eb77b70f6584c76169e7d6b849b88e25ae666696`.
**Fix commit:** `b4df78db07d0d69e29742b034ac1bc23727dff90` on guarded branch `qa/m21304-credential-status-20261107`.
**Scope:** independent, current credential state (valid/expired/suspended/revoked) across Worker dashboard, Company dashboard/order/workforce details and export, public verification and PDF; historical Assurance Case decision is retained rather than falsely presented as live validity.

## Real red → green on identical browser assertions
- **RED:** unpatched source `eb77b70` with the new browser test: **0/1, exit 1**. Chromium could not find the expected expired credential in the Worker's credential dashboard. Evidence: `.autopilot/artifacts/20261107-m21304-baseline-red.log`, MCP session `20f9d447-7c0a-4ad5-8b9e-ab5338e70487`.
- **GREEN:** exact fix commit `b4df78d`: actual Worker+Company+public/PDF/renewal/browser test **1/1, exit 0**. Evidence: `.autopilot/artifacts/20261107-m21304-committed-green-browser.log`, MCP session `5bb10842-9ac2-4351-930e-9ffb65c0f732`.
- **Adjacent native:** exact `b4df78d` source **29/29, exit 0**, including denial of invalid/foreign reassessment, policy expiry, suspension, renewal, immutable history, decision routing and database rollback. `.autopilot/artifacts/20261107-m21304-committed-native.log`, session `a65a5365-5111-4f66-8b69-ed9831ea2135`.
- **Exact-code optimized build:** `b4df78d` Next.js standalone production-style build and route TypeScript **PASS, exit 0** (synthetic test configuration only). `.autopilot/artifacts/20261107-m21304-committed-build.log`, session `9baeba7f-bd88-4fe8-a3d9-1a037178aeb6`.
- **Adjacent browser workflow:** on same product source before committing, two-Company/foreign-case and wrong-invitation browser **1/1 PASS** and full Worker registration→assessment→credential→share/revoke→appeal **1/1 PASS**. Session references `1759f45f-8f69-4d8d-8577-590fc0184675`, `4b8db9d8-f6d6-4f4a-8f7e-47eb192a4680`.
- Guarded repository audit: active feature M2.13.04, recorded failing browser reproduction, exact-success Chromium/native/build evidence. No bypassed hooks or rewritten history.

## Separate canonical QA branch local release checks
These ran on `eb77b70`, **not on the feature commit**, and are not misattributed to it:
- Public verification rate, abuse, capability and read-only security **51/51 PASS** (`20261107-release-test-m1-12.log`).
- Company file scan tenant isolation **3/3 PASS** (`20261107-release-test-secure-scan-runtime.log`).
- Native security/authorization first batch **36 PASS**, with 2 incorrectly invoked wrapper-dependent tests re-run successfully through official runners (no confirmed app bug).
- Actual browser security-response headers, foreign tenant/invitation denial and invalid public capabilities **3/3 PASS** (`20261107-release-browser-security.log`).
- Custom non-destructive localhost black-box signed-out, hostile origin, malformed verification and file access probes **25/25 PASS** on rerun; initial two unexpected responses were verified safe invalid-QR redirect and billing webhook 503 when not configured (`20261107-localhost-penetration-rerun.log`).
- Optimized build and portable isolated localhost preview **PASS** (`20261107-release-production-build.log`, `20261107-release-preview-smoke.log`).
- Native M3.11 operations drill **4/4 PASS**: concurrent registration/review/question selection, 50 authenticated requests across five roles, tenant isolation, disposable physical database+private-object recovery, incident regression (`20261107-release-m311-certification.log`, `artifacts/m3-11/certification.json`). This is local test certification, not production RPO/RTO or scale SLA.
- `npm audit --omit=dev` **0 reported vulnerabilities** (`20261107-production-dependency-audit.json`).

## Frozen Masterplan release gate
- Exactly **218 scenarios across 37 bricks**.
- At SHA `eb77b70`, `npm run audit:current-218-scenarios` reports **216 with some historical scoped evidence**, **2 without mapped local evidence** (M1.01.03 exact-candidate CI and M1.01.04 production environment/rollback), **0 fully release-certified**, decision **NO-GO** (`20261107-exact-218-reconciliation.log`).
- Retained evidence is *per clause* and from various commits, **not** complete positive/negative/retry/cross-role/security/staging proof for 216 scenarios.
- Exact current protected staging, owner acceptance, production PostgreSQL/history and private-object restore, live email/SMS, scanning, liveness/identity, payment, real video/TURN and callbacks, real hardware/camera/mic, authorized full staging pentest/load and production recovery are still unverified.
- Original draft PR #37 also has inherited Autopilot Compliance failure at commit `c4125a31...` due missing trailer; do not disable validation or rewrite shared history without governance approval.

**Release verdict: NO-GO.** Do not count the passing local M2.13.04 feature tests as full 218-scenario release certification. Next: integrate guarded feature branch after CI review, then verify final exact protected staging candidate and all remaining scenario clauses; failures must be fixed and retested.
