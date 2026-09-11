# HSE Verify Full Hardening Mission

Authority: docs/Masterplan(HSE Verify).md plus actual code/test evidence. Work only on branch codex/hseverify-full-hardening-20260911. Main is immutable for this mission.

Rules: root-cause fixes only; TDD for defects/features; never weaken accepted security/isolation tests; remove dead/stale code only with proof; do not fake production providers or owner acceptance; push only this isolated branch; continue until zero ACTIONABLE rows remain or a row is truthfully EXTERNAL_UNAVAILABLE/OWNER_REQUIRED with concrete evidence.

## Ledger
- [VERIFIED_DONE] HSE-M1.01 | Preserve accepted brick; rerun regression if touched | evidence=accepted baseline on main; reopen on any regression
- [VERIFIED_DONE] HSE-M1.02 | Preserve accepted brick; rerun regression if touched | evidence=accepted baseline on main; reopen on any regression
- [VERIFIED_DONE] HSE-M1.03 | Preserve accepted brick; rerun regression if touched | evidence=accepted baseline on main; reopen on any regression
- [VERIFIED_DONE] HSE-M1.04 | Preserve accepted brick; rerun regression if touched | evidence=accepted baseline on main; reopen on any regression
- [VERIFIED_DONE] HSE-M1.05 | Preserve accepted brick; rerun regression if touched | evidence=accepted baseline on main; reopen on any regression
- [VERIFIED_DONE] HSE-M1.06 | Preserve accepted brick; rerun regression if touched | evidence=accepted baseline on main; reopen on any regression
- [VERIFIED_DONE] HSE-M1.07 | Preserve accepted brick; rerun regression if touched | evidence=accepted baseline on main; reopen on any regression
- [ACTIONABLE] HSE-M1.08 | Hard-reverify implementation and complete visible/external-facing behavior acceptance
- [ACTIONABLE] HSE-M1.09 | Hard-reverify implementation and complete visible/external-facing behavior acceptance
- [ACTIONABLE] HSE-M1.10 | Hard-reverify implementation and complete visible/external-facing behavior acceptance
- [ACTIONABLE] HSE-M1.11 | Hard-reverify implementation and complete visible/external-facing behavior acceptance
- [VERIFIED_DONE] HSE-M1.12 | Reverified public verification implementation and concern evidence boundaries | evidence=npm run test:m1-12 passed 28/28 tests; npm run check:m1-12 passed with bounded public projection, opaque capability, non-enumerating rate limits, QR activation, idempotent concern intake, scanned private concern evidence and rollback isolation coverage
- [ACTIONABLE] HSE-M2.01 | Audit actual implementation against canonical masterplan; finish, test, and harden top-to-bottom
- [ACTIONABLE] HSE-M2.02 | Audit actual implementation against canonical masterplan; finish, test, and harden top-to-bottom
- [ACTIONABLE] HSE-M2.03 | Audit actual implementation against canonical masterplan; finish, test, and harden top-to-bottom
- [ACTIONABLE] HSE-M2.04 | Audit actual implementation against canonical masterplan; finish, test, and harden top-to-bottom
- [ACTIONABLE] HSE-M2.05 | Audit actual implementation against canonical masterplan; finish, test, and harden top-to-bottom
- [ACTIONABLE] HSE-M2.06 | Audit actual implementation against canonical masterplan; finish, test, and harden top-to-bottom
- [ACTIONABLE] HSE-M2.07 | Audit actual implementation against canonical masterplan; finish, test, and harden top-to-bottom
- [VERIFIED_DONE] HSE-M2.08 | Reverified existing autosave/resume implementation and recovery contracts | evidence=npm run test:m2-08 passed 55/55 tests; npm run check:m2-08 passed 27/27 checks; M2.08 runtime, browser contract, conflict, storage, and lifecycle coverage passed
- [ACTIONABLE] HSE-M2.09 | Audit actual implementation against canonical masterplan; finish, test, and harden top-to-bottom
- [ACTIONABLE] HSE-M2.10 | Audit actual implementation against canonical masterplan; finish, test, and harden top-to-bottom
- [ACTIONABLE] HSE-M2.11 | Audit actual implementation against canonical masterplan; finish, test, and harden top-to-bottom
- [ACTIONABLE] HSE-M2.12 | Audit actual implementation against canonical masterplan; finish, test, and harden top-to-bottom
- [ACTIONABLE] HSE-M2.13 | Audit actual implementation against canonical masterplan; finish, test, and harden top-to-bottom
- [ACTIONABLE] HSE-M3.01 | Implement/test canonical masterplan capability or truthfully terminalize genuine external provider dependency
- [ACTIONABLE] HSE-M3.02 | Implement/test canonical masterplan capability or truthfully terminalize genuine external provider dependency
- [ACTIONABLE] HSE-M3.03 | Implement/test canonical masterplan capability or truthfully terminalize genuine external provider dependency
- [ACTIONABLE] HSE-M3.04 | Implement/test canonical masterplan capability or truthfully terminalize genuine external provider dependency
- [ACTIONABLE] HSE-M3.05 | Implement/test canonical masterplan capability or truthfully terminalize genuine external provider dependency
- [ACTIONABLE] HSE-M3.06 | Implement/test canonical masterplan capability or truthfully terminalize genuine external provider dependency
- [ACTIONABLE] HSE-M3.07 | Implement/test canonical masterplan capability or truthfully terminalize genuine external provider dependency
- [ACTIONABLE] HSE-M3.08 | Implement/test canonical masterplan capability or truthfully terminalize genuine external provider dependency
- [ACTIONABLE] HSE-M3.09 | Implement/test canonical masterplan capability or truthfully terminalize genuine external provider dependency
- [ACTIONABLE] HSE-M3.10 | Implement/test canonical masterplan capability or truthfully terminalize genuine external provider dependency
- [ACTIONABLE] HSE-M3.11 | Implement/test canonical masterplan capability or truthfully terminalize genuine external provider dependency
- [ACTIONABLE] HSE-M3.12 | Implement/test canonical masterplan capability or truthfully terminalize genuine external provider dependency
- [ACTIONABLE] HSE-X01 | Next/@next/env/eslint-config-next 16.3.3 and sharp 0.35.4 installed; security-floor RED reproduced then GREEN; production npm audit zero vulnerabilities 2026-09-11; compatibility full gate running, checkpoint pending
- [ACTIONABLE] HSE-X02 | Full UI/UX/browser matrix: public + Worker + Company + Admin/Reviewer roles, desktop/mobile, accessibility and failure states
- [ACTIONABLE] HSE-X03 | Third-party/external-facing behavior: unauthenticated/outsider abuse, API boundaries, provider adapters, retries, idempotency and fail-closed behavior
- [ACTIONABLE] HSE-X04 | Final release certification: full gates, migrations/rollback/replay, concurrency/races, recovery, build, smoke, security and branch evidence

## Checkpoint 2026-09-11 item_0 resume
- Verified branch remained `codex/hseverify-full-hardening-20260911` at HEAD `b8fd9609284bea8b52a6bcb159f208796ff6480f` with existing dirty worktree preserved.
- Re-ran M2.08 evidence after native session restart: `npm run test:m2-08` passed 55/55; `npm run check:m2-08` passed 27/27.
