# M1.03.05 — staff invitation token isolation, cancel/retry, and mobile MFA overflow (SCOPED QA)

**Source:** signed merged QA `d56650232d924c1959de882dac4609883ad1e18e` (PR #80, 17/17 merged-SHA workflows green); isolated branch `qa/verify-m10305-staff-invite-20261111`, worktree `hseverify-m10305-staff-invite-20261111`; November 11, 2026 Asia/Karachi. V4 audit session `08d89494-c36f-4f66-8c0a-6bc8b86da399`, feature `M1.03.05-STAFF-INVITATION-QA`.

**Verdict: scoped software regression PASS, frozen M1.03.05 remains NOT_FULLY_VERIFIED, release NO-GO, FULLY VERIFIED 0/218.** These are local synthetic Next.js/Chromium/PGlite tests against the QA base plus changes in this isolated worktree, not final staging or real external providers. Check the exact candidate SHA and CI after PR submission.

## Root defect found and fixed (actual browser RED -> GREEN)

1. **Actual Chromium RED**: on the staff invitation acceptance screen after entering a valid profile and reaching MFA setup, viewport 320px, document scrollWidth **430px**. DOM box investigation isolated the real TOTP setup key's `<strong>` text, width **384px**, spanning x=46 to 430. This is a genuine horizontal overflow of an unbroken key, not a screenshot guess. Exact command `node --test tests/browser/staff-invitation-cancel-retry.browser.test.mjs`, **exit 1**, log `.autopilot/artifacts/M10305_STAFF_MFA_320_OVERFLOW_RED_20261111.log`.
2. **Root fix** in `src/app/globals.css`: constrain `.security-key-card` to available width and display the key as a block with `max-width:100%` and `overflow-wrap:anywhere`. Key content is unchanged and visible, with no blanket overflow hiding.
3. **Actual Chromium GREEN** on same test, **1/1 PASS, exit 0**: 320px viewport and document width both **320px**, zero overflowing elements; actual **Cancel enrollment** after profile/MFA creation; canceled flow/unfinished account cleaned; opening same pending invitation again starts a fresh MFA secret and registration; correct TOTP activates exactly one Verifier account/session; wrong-role Worker dashboard is denied; 390px login has no overflow; old invitation becomes unusable; authoritative database shows canceled and complete flows, one assigned Verifier role, active MFA, one session, one enrollment event and no browser 500/page errors. Log `.autopilot/artifacts/M10305_STAFF_CANCEL_320_BROWSER_GREEN_20261111.log`.

**Test harness-only failures handled separately:** first fresh-worktree browser attempt failed before the app started because a `node_modules` symlink pointed outside Turbopack's hermetic workspace. Replaced the symlink with a *local copy* of identical locked QA dependencies; no source modification was needed. The first native test incorrectly assumed only one seeded account; using a before/after count fixed that assertion. Neither was counted as an application exploit.

## Adjacent exact-source regressions

- `node --test --test-concurrency=1 tests/browser/staff-invitation-lifecycle.browser.test.mjs tests/browser/staff-invitation-revocation.browser.test.mjs`: **4/4 PASS**, exit 0. Real Chromium: Root invites Company, Assessor, Verifier, Admin and Root; MFA setup and sign-in, fixed portal roles, sessions and database; consumed token rejected, five roles' expired fresh/cached forms rejected; unknown token no persistence; issuer revoke denies fresh and cached profile, plus valid cached MFA setup. Raw `.autopilot/artifacts/M10305_STAFF_EXISTING_BROWSER4_GREEN_20261111.log`.
- `node --test tests/platform/staff-enrollment-token-boundaries.test.mjs tests/platform/staff-invitation-revocation-runtime.test.mjs tests/platform/authentication-invitation-expiry.test.mjs`: **13/13 PASS**, exit 0. New tests: **hybrid invitation+enrollment token mismatch** cannot cross-enroll or cancel another role; an MFA-pending account can be safely canceled, removed, reopened with fresh MFA setup, completed once; token rotation invalidates stale credentials; accepted invitation rejects replay; no session before login. Existing native: issuer/scope revocation, expiry, repeat rejection, immutable history, audit-insert failure transaction rollback, account removal and owner permissions. Raw `.autopilot/artifacts/M10305_STAFF_NATIVE13_GREEN_20261111.log`.
- `npm run typecheck`: **PASS** strict TS and Next route types, raw `.autopilot/artifacts/M10305_TYPECHECK_GREEN_20261111.log`.
- `npm run lint`: **exit 0**, **0 errors, 9 inherited unrelated unused-symbol warnings**, raw `.autopilot/artifacts/M10305_LINT_EXIT0_WARN9_20261111.log`.
- Both new JavaScript test files passed `node --check`; local two-job GitHub Actions workflow `.github/workflows/m1-03-staff-invitation-boundaries.yml` parses as YAML; `git diff --check` and `python3 .autopilot/autopilot_state.py validate` passed.
- New GitHub workflow demands **exact PR-head SHA** Node 24 + real Chromium + 5 browser test cases and 13 native cases, retains per-SHA artifacts. **Not run on GitHub at report creation**.

## Mandatory remaining acceptance and release blockers

**Not fully verified:** full authorized 6-role endpoint/action/tenant penetration matrix, independent HTTP-origin and server-action tampering, scoped real-PostgreSQL races between cancel/revoke/accept, outage/retry and expired requests under production load, genuine provider email delivery, exact final staging, security configuration/protection, realistic load/backup/restore, notifications/receiving-role state across all 218, and Owner UAT. No release GO.

## First continuation actions

1. Guarded V4 commit of only the root CSS correction, two focused test files, new exact-SHA CI workflow, this report, TSV, resume and audit chain. Do not alter concurrent worktrees.
2. Push `qa/verify-m10305-staff-invite-20261111`; open PR against current release QA `qa/a28-eligibility-read-guard-20261107`. Require both new GitHub jobs, Autopilot compliance and all triggered checks PASS **on the exact PR SHA**.
3. Merge through GitHub's verified two-parent signed merge only; check merged QA-SHA workflows, record failures and remediation if any.
4. Resume first unfinished actionable security test: M1.03.05 direct role/origin/tenant server-action abuse or actual PostgreSQL cancel-vs-revoke-vs-accept; where blocked externally, move to M1.03.06 all-portal wrong-credentials/MFA redirects. Never count scoped green toward 218/218.
