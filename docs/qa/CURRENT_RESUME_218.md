# HSE Verify — current QA continuation checkpoint

## 2026-11-09 — M3.12.02 executable DB readiness probe and alerting (SCOPED LOCAL)

**FULLY VERIFIED 0/218 | COMPLETE PENTEST INCOMPLETE | RELEASE NO-GO.**
Source active QA branch `qa/a28-eligibility-read-guard-20261107` SHA `3673fc42b54df50a2bd145743b04f8b63a1a445d` before this PR.
Isolated worktree `hseverify-m312-alert-drill-20261109`, branch `qa/m312-monitor-probe-alert-20261109`.
Do not touch other concurrently used QA worktrees or re-run live/staged tests without inspection.

### Reproduced gap and scoped delivery

- The Admin `alerts` handover field was only a manual status; no independent executable database probe or real HTTP alert sender existed. Initial local alert tests were RED before the monitor command existed: `.autopilot/artifacts/M312_MONITOR_BASELINE_RED.log`.
- Added protected `GET /api/operations/readiness` that checks one real SQL query and compares bearer credentials in constant time, returns exact runtime SHA, no PII and no caching. This proves **database reachability only**, not all migrations or full stage health.
- Added operator-invoked `npm run ops:check-readiness` that requires exact expected SHA and a separately configured authenticated HTTPS alert receiver. Actual controlled loopback HTTP tests cover outage OPEN/RECOVERED, initial/recovery receiver 5xx and idempotent retry, duplicates suppressed, corrupt state, locking, missing configuration and wrong SHA. The source does not configure a real provider or schedule a job.
- `npm run test:m3-12-ops-monitor` **11/11 PASS** at source `3673fc4` with isolated changes: nine native actual HTTP monitor tests (including actual process race and interrupted alert/recovery) and two actual Next.js HTTP database probes using migrated PGlite and deliberately unavailable PostgreSQL. Exact logs `.autopilot/artifacts/M312_MONITOR_FULL_GROUP.log`, `.autopilot/artifacts/M312_MONITOR_live-next-readiness-retry.log`.
- Strict TypeScript **PASS exit0**, ESLint **PASS exit0 (9 inherited warnings, zero errors)**; logs `.autopilot/artifacts/M312_MONITOR_{typecheck,lint}.log` and quality TSV. A dedicated GitHub M3.12 workflow is added to prove the same tests on the PR SHA.
- Operational requirements and proper human response/rollback path: `docs/operations/readiness-alert-incident.md`. The existing GitHub rollback-candidate workflow **builds an artifact only**, not a staged deploy or automatic rollback.

### BLOCKED_EXTERNAL / still unverified

No independently configured production monitoring scheduler, pager/webhook operator, on-call acknowledgment, real provider email/SMS/video/payment/liveness/scanner/object storage delivery, protected final staging, actual incident/rollback/recovery with representative RPO/RTO, realistic load, final 218 browser/security matrix or Owner UAT. **M3.12.01–.04 remain NOT_FULLY_VERIFIED; release NO-GO.** HTTP 2xx from a synthetic local receiver is not actual human or provider delivery.

### NEXT FIRST

1. Commit guarded new code+real audit session; **rerun full 8/8 suite on exact new commit SHA**, typecheck/lint and verify no unrelated generated changes.
2. Push isolated branch, open PR to current QA branch; wait for **all** CI including new M3.12 operational workflow, verify GitHub-generated merged SHA and signature.
3. If GitHub/runner failure, reproduce exact job logs and repair. Do not bypass compliance.
4. Resume M3.12.02 actual on-call receiver/provider delivery and M3.12.04 executable rollback and data restoration in approved protected staging when available. If external environment still blocked, explicitly BLOCKED_EXTERNAL and advance to next actionable feature-by-feature test; never promote 0/218 count without full evidence.
