# M3.05 / M2.06 — Funding notification Chromium outbox prerequisite

**Verdict:** Narrow browser test-harness bug reproduced and fixed locally, NOT a complete Masterplan scenario certification. Full release remains **NO-GO, 0/218**.

## Source and confirmed RED
- QA baseline SHA: `581e0189f6f6df2a9b2383a8499b3c3d56b6fbce` on `qa/a28-eligibility-read-guard-20261107`.
- Unmodified `npm run test:funding-notifications-browser` failed twice at `tests/browser/assessment-funding-notification.browser.test.mjs:117` with `SyntaxError: Unexpected end of JSON input`. The Worker submitted an actual funding request, then the test tried to parse empty stdout from `scripts/run-outbox-worker.mjs --once`.
- Standalone reproduction in an isolated clean worktree: outbox entry `.outbox-worker-dist/outbox/outbox-worker.js` did not exist; CLI exited 1, stdout zero bytes, stderr `Error: Build the outbox worker before starting it.` The **test runner lacked the required build step**; no product-notification defect or security bypass has been established.
- Original browser fail receipt: `hseverify-m305-billing-20261107/.autopilot/artifacts/20261107-M305-exact581-test-funding-notifications-browser.log`. Isolated reproduction: `hseverify-funding-worker-cli-red-20261107/.autopilot/artifacts/20261107-M305-unbuilt-cli-RED.{stdout,stderr}`.

## Corrective patch
- `package.json` canonical `test:funding-notifications-browser` now runs `npm run build:worker && node --test tests/browser/assessment-funding-notification.browser.test.mjs`. Compiles the **real** production outbox graph; no synthetic delivery substitution.
- Browser test checks CLI stdout before `JSON.parse`, exposing stderr and the missing runtime cause rather than masking it as malformed JSON.
- No app/service authorization, funding, credit, notification or provider semantics changed.

## Actual browser GREEN before commit
- Corrected command built outbox worker and real Chromium Worker request → Company actionable bell → Company approval → Worker actionable bell and assessment prechecks **1/1 PASS**, with the real outbox CLI delivering both events, persisted database projection and unrelated-recipient non-disclosure. Log: `hseverify-funding-worker-cli-red-20261107/.autopilot/artifacts/20261107-M305-funding-outbox-harness-GREEN-attempt1.log`; exit 0.
- Baseline same QA SHA `npm run test:funding-notifications` **28/28 native tests PASS** (positive/negative/replay/revocation/concurrency, notifications/audits). Report `hseverify-m305-billing-20261107/.autopilot/artifacts/20261107-M305-exact581-test-funding-notifications.log`. Original browser remained RED because it omitted build.

## Still to verify
- Adjacent revoked Company-Worker funding browser, exact **committed and integrated** QA SHA rerun, CI, provider requirements and full staged six-role penetration/security/API/tenant/expiry/retry/interruption tests. Do not promote M3.05 or M2.06 as fully verified.

## Adjacent tests on patched isolated worktree
- `npm run typecheck` PASS (Next route type generation and strict TypeScript).
- `npm run lint` exit 0, nine pre-existing unrelated warnings.
- `npm run test:m2-06-revoked-funding-browser` **2/2 PASS**: actual Company–Worker relationship revocation blocks pending funding and case creation; zero Company credits denies funding, then real sandbox checkout captures exactly one credit and permits a single owned Worker case without double reservation. Log `.autopilot/artifacts/20261107-M305-outbox-fix-test-m2-06-revoked-funding-browser.log`; `...-quality.tsv` exit statuses all 0.
- No actual live card/payment, external SMTP or SMS delivery was verified; retain BLOCKED_EXTERNAL for providers at release signoff.
