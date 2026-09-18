# HSE Verify Repair Ledger

Updated: 2026-09-18
Baseline: `11dfaa22f9dcaa8838feac8c93b360ae36e50aa2`
Branch: `qa/hse-production-hardening`

| ID | Finding | Classification | Root cause confidence | Status | Completion evidence |
|---|---|---|---|---|---|
| HSE-001 | Standalone Worker Privacy crashes | Confirmed product defect | Confirmed | CODE FIXED / LIVE PENDING | `test:m3-07` 14/14, typecheck, fresh 0064 migration pass; live deploy pending |
| HSE-002 | Credential detail/PDF returns 500 | Deployment/schema defect | Confirmed | OPEN | Live DB lacks queried `signature` column |
| HSE-003 | Migration 0057 checksum mismatch and pending migrations | Release blocker | Confirmed | CODE FIXED / LIVE PENDING | Restored immutable 0057; additive 0064 passes fresh full migration; live apply pending |
| HSE-004 | Company registration fails for fresh unique company | Confirmed product/deployment defect | Failure confirmed; exact statement hidden | OPEN | Fresh unique browser reproduction |
| HSE-005 | Worker evidence retrospective script stops at login | Test harness/fixture blocker | Confirmed | OPEN | Script uses fixed unseeded account |
| HSE-006 | Integrity route is a developer simulation harness | Confirmed incomplete feature | Confirmed | OPEN | Source and live UI inspected |
| HSE-007 | Camera/microphone disabled globally | Configuration/feature conflict | Confirmed | OPEN | `next.config.ts` |
| HSE-008 | CSP and HSTS absent | Security release blocker | Confirmed | OPEN | Live response headers |
| HSE-009 | Worker navigation omits Privacy and Share Links | UX/navigation defect | Confirmed | OPEN | Navigation source + live UI |
| HSE-010 | Raw/unfinished portal surfaces | UX defect | Confirmed | OPEN | Live UI evidence |
| HSE-011 | Worker ID wording conflict | Product copy/state defect | Confirmed | OPEN | Live journey + source |
| HSE-012 | Production providers unavailable | External configuration blocker | Confirmed | OWNER/DEPLOYMENT BLOCKED | Requires real provider accounts/credentials |
| HSE-013 | GitHub branch has no enforced green status | Release governance blocker | Confirmed | OPEN | Exact SHA status inspected |
| HSE-014 | Duplicate migration numeric prefixes | Governance concern, not current runtime failure | Confirmed | DEFERRED SAFELY | Runner keys/sorts by full filename; renaming applied IDs would create harmful drift |
| HSE-015 | Project status documents are stale/inconsistent | Handoff defect | Confirmed | OPEN | Code/masterplan/status comparison |

## Resume rule

Start at the first `IN PROGRESS` item, then the first `OPEN` item. Current next item: HSE-004 Company registration diagnostic logging and precise reproduction. Do not retest closed items unless a changed dependency intersects them. Mark `DONE` only with the exact command, exit code, and live evidence reference.


## Evidence log

- 2026-09-18: Added failing standalone Privacy tests; failures reproduced at domain tenant guard and repository equality query.
- 2026-09-18: Minimal nullable tenant-scope fix implemented across page/action/domain/service/repository.
- 2026-09-18: Confirmed 0057 was mutated after application; restored original SQL and moved schema additions to 0064.
- 2026-09-18: `npm run test:m3-07` passed 14/14.
- 2026-09-18: `npm run typecheck` passed.
- 2026-09-18: full fresh in-memory migration stack through 0064 passed.
- 2026-09-18: `npm run lint` passed with 21 pre-existing warnings and zero errors.
- 2026-09-18: `npm run verify:full` passed end-to-end with exit code 0, including build and deployable preview smoke.
