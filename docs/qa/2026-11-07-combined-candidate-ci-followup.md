# HSE Verify — combined release-candidate CI follow-up (2026-11-07)

**Repo:** `itxsam57/hseverify-production-hardening`
**Branch:** `qa/release-candidate-20261107` / draft PR #50.
**Product SHA reviewed:** `fe07ced94384b706b94ee2bebec3195eb8fc1def`; the following patch changes browser tests and CI only.

## Verified local baseline
- Original exact-product full repository `npm run check` passed **92/101 stages** before stage 93 reported two calibration-vs-terminal-media assertion failures.
- Corrected stage 93 `npm run test:masterplan-integration`: **82/82 PASS**.
- Local serial `test:critical-browser` matrix, with its first disconnected suite independently rerun: **42/42 named browser suites PASS**, recorded in `.autopilot/artifacts/20261107-browser-matrix-status.tsv`. All passed on product SHA `fe07ced`. This is local test evidence, not protected staging.
- Exact SHA `fe07ced` optimized build: PASS, separate clean worktree `hseverify-release-build-20261107` artifact `.a28-release-build.log`.
- Exact SHA `fe07ced` owner acceptance native: **19/19 PASS**, clean worktree artifact `.a28-release-test-owner-acceptance-regressions.log`.

## Official GitHub test run failure
[Actions run 42322274926](https://github.com/itxsam57/hseverify-production-hardening/actions/runs/42322274926) used `fe07ced`:
- 10 jobs success, `consumer-cohorts (2)` failure, `connected-browser (4)` cancelled at the 60-minute job limit.
- `consumer-cohorts (2)` timed out at `tests/browser/m1-08-company-verification.browser.test.mjs:382`. Its permission assertion queried **all** `fieldset input[name=permissions]` fields on the page, mixing the Company invitation form with potential editable member forms; test now scopes selector to the actual `Create Company Team invitation` form and retains exact `viewer` role and four checked permissions. Same browser scenario local **1/1 PASS** (`.autopilot/artifacts/20261107-m108-scoped-form-GREEN.log`).
- `connected-browser (4)` reached case replay: test timeout at 300 seconds and did not exit until runner cancellation after 60 minutes. Exact local standalone re-test also reproduced a 300-second timeout once (`.autopilot/artifacts/20261107-ci-case-replay-standalone.log`). **This intermittent stall is not proven root-cause-fixed.**
- Stage instrumentation now records migration, seed, app launch, login, guidance generation/acceptance, mark save POST receipt/completion, reload, scoring decision, and Admin replay if `HSE_REPLAY_PROGRESS_FILE` is configured. One combined local run stalled after AI guidance acceptance before confirmed first-mark completion; a later finer-grained combined run passed.
- Isolated instrumented replay **1/1 PASS**, three further stress repeats **3/3 PASS**, original CI-style pair **2/2 PASS**, and bounded response-completion CI-style pair **2/2 PASS**. Evidence: `.autopilot/artifacts/20261107-case-replay-stage-diagnostic.log`, `20261107-replay-stress-{1,2,3}.log`, `20261107-replay-pair-fine-grain.log`, `20261107-replay-bounded-pair-GREEN.log`. The intermittent risk remains.
- Save-mark and save-decision HTTP response completion now has explicit deadlines; an incomplete stream fails the test rather than hanging indefinitely. The GitHub step has an **8-minute timeout** and prints safe, narrow progress markers after failure. Neither change bypasses scoring, database persistence, UI validation, or authority rules.

## Next release gates (not waived)
- Trigger the official full Masterplan QA workflow on the updated exact commit and inspect every job. This evidence cannot be called green while any job fails/cancels.
- Verify actual deployed final staging with all Worker, Company, Verifier, Assessor, Admin and Root success/denial/retry/cross-role workflows and persisted results, plus accessibility, real email/SMS/scanning/liveness/video/payment providers, authorized full pen testing, load, PostgreSQL/object backup and recovery, owner acceptance and release provenance.
- Frozen 37-brick Masterplan: **218 scenarios**. Current full release-certified **0/218**. Historical `216/218` means only some scoped or past-commit local evidence. Do not promote local browser passes to full certification.

**Verdict: NO-GO, exact protected staging still unverified.**
