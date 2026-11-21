# M3.07.01 — Direct credential-appeal API cross-Worker evidence reference abuse

**Finding:** CONFIRMED cross-account evidence-reference authorization bypass on the controlled synthetic QA source.
**Severity:** Medium (appeal/credential decision provenance integrity). No foreign file bytes, customer data or production compromise demonstrated.
**Release:** NO-GO. FULLY VERIFIED: 0/218; final staging and full pentest incomplete.

## Authorized reproduction — RED
- Source SHA: `74978c853a70a228a55f093ed330c9734d460dfd`, isolated `hseverify-m307-api-evidence-20261108` PGlite + real headless Chromium, no real users.
- Seed two distinct actual Worker accounts, each owning a current qualification evidence record. Sign in as Worker A, target **Worker A's issued credential** via `POST /api/credentials/{credentialId}/appeals`, but submit the **current record ID owned by Worker B** in `evidence`.
- Before fix, API responded **HTTP 201** rather than forbidden, allowing Worker B's evidence reference to become part of Worker A's appeal. UI `submitCredentialAppealAction` already performed owner checks, but direct API did not and `CredentialAppealsService.submit` persisted caller-supplied references.
- Retained RED evidence: `.autopilot/artifacts/20261108-M307-appeal-direct-foreign-evidence-RED.log`, test process session `2c4193b3-0358-48d8-9d62-d7a6fd2b03cb` exit1, assertion actual201 expected403.

## Root fix
In `src/app/api/credentials/[credentialId]/appeals/route.ts`:
- Require authenticated Worker portal principal; validate the owned target credential.
- Validate *every* supplied record ID against `WorkerEvidenceService.listCurrent(principal)`, the same authoritative owner-bound source used by the Worker UI; reject other Workers' IDs **403 before writing any appeal**.
- Strictly parse JSON object/grounds/evidence ID types, duplicates, bounded length and opaque sequence; return **400** for malformed input.
- Convert an already-open appeal replay into **409 Conflict** instead of an uncaught server error.
- Return a private, non-cacheable success response. No production provider or permission grant bypass introduced.

## Real-browser security verification — GREEN
Expanded signed-in Chromium test in `tests/browser/credential-appeal-operational-e2e.browser.test.mjs` exercises the original exploit and direct API negative matrix. Observed HTTP statuses:
- Anonymous `307` redirect; spoofed Worker ID `403`
- Malformed or duplicate evidence IDs `400`; traversal-like sequence `400`
- Foreign Worker's current evidence record `403`
- Numeric and too-short grounds `400`
- Second open appeal/replay `409`

The same test completed the **legitimate Worker appeal → independent Admin review → accepted reassessment → Living Record** workflow, then read the persisted database to assert **exactly one appeal row and only Worker A's own selected evidence ID**. Real-browser pass log `.autopilot/artifacts/20261108-M307-direct-api-db-invariants-GREEN.log` (exit0). A prior earlier pass after the initial fix is `20261108-M307-appeal-direct-foreign-evidence-GREEN-attempt1.log`.

TypeScript and lint ran exit0 (nine existing unrelated lint warnings) under `.autopilot/artifacts/20261108-M307-direct-api-quality-status.tsv`. Adjacent rejection and evidence browser tests have separate status and logs.

## Remaining release gates
Merge/rebase through the guarded QA branch, **retest the exact integrated SHA** and CI. Additional race/expiry/CSRF, cross-tenant and all-role API coverage is still required. Real email/SMS/payment/identity/video/storage, final staging pentest/load/restore and Owner UAT are not certified.

## Integrated QA candidate retest (PR #59 already merged)
- Integrated source baseline: `f2fb8f700b5af8777c7c707dbb940eee7433a566`, contains corrected canonical `test:m3-07` appeals + separate retained privacy gate. The first isolated security branch `a315c47267a90b64176a2c55ec54eb500459f7e2` diverged at the append-only audit file; the exact same **three project files** were transferred onto this clean QA tip without rewriting either audit chain.
- Actual Chromium direct API foreign-evidence and nine request-outcome probes + legitimate Worker-to-Admin-to-Living-Record **1/1 PASS**; rejection/stale Admin **1/1 PASS**; scanned private evidence in authorized Admin browser **1/1 PASS**.
- Strict TypeScript **PASS**; lint exit0 (nine pre-existing warnings). All five group statuses are 0 in `.autopilot/artifacts/20261108-M307-integrated-f2fb-results.tsv` (local worktree `hseverify-m307-security-integrated-20261108`).
- Still requires actual **committed/integrated exact QA SHA**, GitHub CI, additional authorized API race/expiry/CSRF matrix and final release evidence before any Masterplan status becomes fully verified.
