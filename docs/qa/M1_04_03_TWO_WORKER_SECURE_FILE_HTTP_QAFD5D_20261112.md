# M1.04.03 — two independent Workers cannot read another Worker's signed secure-file bytes (SCOPED ONLY)

Date: 2026-11-12 Asia/Karachi. Signed QA base `fd5d6bdb7fedf133288bbf8fc8e86267a6cde9e6` (PR #89 signed two-parent merge; **26/26 exact merged-SHA CI PASS**). Isolated worktree `hseverify-m10403-worker-file-bola-20261112`; branch `qa/verify-m10403-worker-file-bola-20261112`, V4 audit session `94c1781e-2339-48ce-9d88-b2ed52f8c7e3`, cycle `f264ce3fcbac4de8a5fdc0b828175b59`. No other worktrees changed.

**FULLY VERIFIED 0/218 | M1.04.03 NOT FULLY VERIFIED | PENTEST INCOMPLETE | ≥10 known BLOCKED_EXTERNAL | RELEASE NO-GO.**

## Coverage-only baseline RED

Existing native `tests/platform/secure-file-access-runtime.test.mjs` already checked Worker owner issue, a different Worker denied by service, reuse and revoked session. A separate real **Company A/B** HTTP suite tested tenant-bound files. But there was **no actual Chromium Worker A/B HTTP** test for existing secure file IDs, signed capability replay or forged account/role headers with authoritative audit. `git ls-files --error-unmatch tests/browser/worker-secure-files-cross-account.browser.test.mjs` returned expected code 1. Missing coverage is not a confirmed product defect. Evidence `.autopilot/artifacts/M10403_WORKER_SIGNED_FILE_HTTP_COVERAGE_RED_20261112.log`.

## Actual browser two-account positive and negative HTTP

`node --test tests/browser/worker-secure-files-cross-account.browser.test.mjs`: **1/1 PASS, exit 0**, actual Chromium, real Next.js browser/forms/API and migrated PGlite. Synthetic credential fixtures only.

- **Worker A at 390px and Worker B at 320px** independently signed in using actual Worker login forms. Two individually owned private PDF objects were materialized in the disposable local-test filesystem, validated by PGlite available/clean state. This does NOT exercise a genuine malware scanning or object-storage provider.
- Each Worker issued their own file capability using `POST /api/secure-files/access`, then fetched the signed `GET /api/secure-files/download` endpoint, obtaining **HTTP 200 with exact original private PDF bytes**. Private no-store cache headers checked.
- **Both directions of real existing foreign file IDs** denied **404** on issue. Signed URL copied from the rightful Worker to the other Worker denied **404**. Anonymous copied signed URL denied **404**. Attempts to forge `x-hse-account-id`, `x-hse-active-role=root` and `x-hse-tenant-id` while requesting a foreign file denied **404**. No private foreign bytes returned.
- Wrong-purpose preview replay of a download token denied **404**. A legitimate owner preview token fetched **200** while the foreign Worker was denied **404**; duplicate access token query rejected **404**; extra forged JSON `accountId` rejected **400**.
- Real Worker UI **Sign out** revoked the original A session, immediately invalidating its previously issued signed file token **404**. Independent Worker B remained signed in.
- Final PGlite verified **two available worker-owned files with null tenant/membership** and **six immutable access issue/serve audit records**, each exclusively bound to its rightful original Worker account/file; no foreign owner facts or writes.
- Raw actual Chromium evidence `.autopilot/artifacts/M10403_TWO_WORKER_SECURE_FILE_HTTP_CHROMIUM_GREEN_20261112.log`.

## Adjacent native and quality evidence

- `node scripts/run-secure-access-runtime-tests.mjs` **5/5 PASS**: Worker owner/revoked session, Company tenant membership at issue/serve, immutable audit and route constraints, migration safety. Raw `.autopilot/artifacts/M10403_NATIVE_SIGNED_FILE_ACCESS5_GREEN_20261112.log`.
- `npm run typecheck` **PASS** with Next route generation; `npm run lint` exit0 (**0 errors / 9 inherited warnings**); browser JS syntax, new two-job YAML/Bash and diff checks PASS.
- `.github/workflows/m1-04-worker-private-file-http.yml`: exact PR SHA real x86 Chromium Worker A/B HTTP test plus native 5/5 signed file tests, archived evidence. If CI browser fails, required error annotation shows test failure while preserving nonzero exit. No test bypass. **GitHub exact SHA PR CI pending.**

## Remaining strict acceptance

Synthetic private files and seeded accounts prove no real provider delivery, staging HTTPS, provider scan, interruptions, longer races, all Worker cross-object ID/capability/direct action endpoints, role/notification receiving state, full pentest, realistic load and backup/restore, accessibility/owner UAT. M1.04.03 **NOT FULLY_VERIFIED**. Do not elevate frozen count from **0/218**.

**NEXT:** complete quality lint, guarded commit/push only focused test, CI, report, TSV and checkpoint; require exact PR-head real Chromium/native/Autopilot CI green, signed two-parent GitHub merge and **all merged SHA** workflows green. Separate M1.04.02 report [PR #90](https://github.com/itxsam57/hseverify-production-hardening/pull/90) stays unmerged pending its own GitHub runner queue and original failed Chromium diagnosis. Release **NO-GO**.