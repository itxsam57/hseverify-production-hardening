# ZERO-004 — six-role login, sessions and password change

**Three original scenario workflows; scoped browser result 3/3 PASS, 0/3 TECH FULLY VERIFIED.** Frozen app `7ff30ea140a5145e5d5ba761f7c7aef24c895269` and QA head during test `11eb67ecfdc50b4215b06ce0777b348a91fc4750`. Actual headless Chromium with isolated synthetic PGlite development fixtures; production and existing staging not modified.

| Original workflow | Original browser case | Result |
|---|---|---|
| `M1.03.06` | M1.03.06 all-six mobile 320/390 role login, generic bad credentials/MFA, cross-portal and DB | PASS (1/1) |
| `M1.03.07` | M1.03.07 six-role Exit retains copied cookie; modal Cancel preserves; Sign Out rejects tab and copied cookie replay | PASS (1/1) |
| `M1.03.08` | All six roles change passwords with reauthentication, keep current sessions and revoke other sessions | PASS (1/1) |

## Specialist review

- **ENGINEER — SCOPED PASS:** Real UI/form + database-backed tests passed across six roles (wrong credentials/MFA, 320/390 mobile and cross-portal denial; Exit/Cancel vs Sign Out; copied-cookie replay after logout; password reauthentication + other-session revocation). Source spot-check: DB sessions are revoked by account/session; active-session queries check token, expiry and revocation. No full maintainability/dead-code audit.
- **CYBERSECURITY — SCOPED PASS / NOT FINISHED:** Three selected browser tests exercise negative credentials/MFA, cross-role access denial, stolen session-cookie replay after logout and privileged account-password change/revocation. Still missing exhaustive adversarial authenticated API and tenant attack matrix, race/replay on concurrent sessions, login throttling beyond selected variants, full secrets/CSRF security pentest and independent security adjudication. High/critical findings for entire system **UNKNOWN**.
- **REVIEWER — INCOMPLETE:** Exact three test case identities, one PASS/zero FAIL per log, and safety/isolation verified. No second independent reviewer has signed off all original scenario requirements, source code, screenshots/a11y or complete cross-role outcomes. Never award a full pass from scoped green.

## Missing technical evidence

- M1.03.06: full negative login/account lockout, every portal recovery edge, role and tenant matrix, origin/login-CSRF and complete mobile accessibility review.
- M1.03.07: additional active-session/device lifecycle and concurrent revoke/sign-out races, server-side private data authorization after logout, all other UI/account flows.
- M1.03.08: privileged recovery and MFA recovery-code reuse paths, concurrency across password-change sessions, live adapter contract readiness (later dedicated related batch).

## Private raw test logs (hashes retained)
- `M1.03.06`: `private-workstation:artifacts/agency-zero/ZERO-004/M1.03.06.log` SHA256 `61c33eb8dfda674ee405d31a62e90bb7be0a348271ad8d049085e604851d31a8`
- `M1.03.07`: `private-workstation:artifacts/agency-zero/ZERO-004/M1.03.07.log` SHA256 `964b3d12b9823d368da46591e8b1bc4c40904e4f9d5626ae5de039ad9a63d434`
- `M1.03.08`: `private-workstation:artifacts/agency-zero/ZERO-004/M1.03.08.log` SHA256 `3ce4e28913f82eb4ab50d974b2edcbeb02a68c152bfe0ebf25e72ff47578f4bd`

## Scheduling

All three have evidence-backed scoped PASS but remain **TECH INCOMPLETE**; no false pass or repeat test demanded. Advance to **ZERO-005**; revisit ZERO-001..004 for remaining expert / role / security proofs after untouched related scenarios are attempted. No application code/deployment touched.

Recorded UTC: 2026-11-22T17:42:02.661138+00:00
