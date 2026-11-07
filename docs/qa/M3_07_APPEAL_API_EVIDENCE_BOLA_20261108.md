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
