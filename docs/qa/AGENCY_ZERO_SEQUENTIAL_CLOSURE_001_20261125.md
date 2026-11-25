# ZERO-001 strict sequential closure: four original units remain OPEN

Owner directive: do not enter ZERO-002 or any later original batch until ALL FOUR ZERO-001 units have exact approved SHA evidence and independent Engineering, Cybersecurity, Reviewer, full UI/functional/cross-role, relevant provider/adapter and manual security gates PASS. All 58 historical attempts are retained, without counting scoped smoke results as certification. No launch approval inferred.

**Current: TECH FULLY VERIFIED 0/218; ZERO-001 0/4; OWNER TESTING READY NO.** Approved product source pin is 7ff30ea140a5145e5d5ba761f7c7aef24c895269. Working QA branch has two inherited changed application paths; official source drift guard is intentionally RED. No candidate repin, production mutation, or stage restart.

## Four original scenario states and actual blockers

| Original ID | ENGINEER | CYBERSECURITY | REVIEWER | Full |
|---|---|---|---|---|
| M1.01.01 Runtime environments/secrets/demo isolation and startup | Prior CSP/HSTS/no-sniff/frame real Chromium source checks scoped PASS | Complete startup matrix, secrets isolation, signed stage CSP and manual authenticated penetration not signed | Full six-role visible UX / code / independent signoff missing | OPEN |
| M1.01.02 All 139 migrations, preserve history and safe rollback | Prior two initial PG16 cases and two missing reverse/up cases TAP all passed; real PG16 139 reversible in disposable fixture | Real permission/tenant/migration rollback threat model not comprehensively assessed | Independent reviewer full migration safety, backup/risk approval missing | OPEN |
| M1.01.03 Exact canonical SHA CI release gate | Hosted exact pin7ff audit previously failed due test/production environment mismatch; proposed QA917 source full audit attempt1 terminal failed scoring Case Replay. Local same QA source diagnostic TAP passed; hosted retry attempt2 IN_PROGRESS | Full authenticated security audit and high/critical risk clearance still UNKNOWN; failed CI cannot certify | No independent full CI and approved integration signoff | OPEN |
| M1.01.04 Release provenance, HTTPS health and authorized rollback | Existing stage healthy and isolated PG16 encrypted backup restored 193 tables/979 rows; six PUBLIC login GET200 and readiness verified | Active stage Git HEAD6a differs from declared pin7ff and metadata d204; served binary not signed source-attested; backup/key on SAME VM; no offsite/approved rollback | No operator-approved actual cutover/rollback and authenticated six-role stage UAT | OPEN |

## Enforced sequential execution (new QA control, no product changes)

- Updated AGENCY_ZERO_PROTOCOL.md, AGENCY_ZERO_CURSOR.json, new scripts/agency_zero_sequential_closure.py, and fail-closed guards inside scripts/agency_zero_control.py. Current closure_active_batch_id=ZERO-001, policy STRICT_SEQUENTIAL_FULL_ONLY.
- Observed: closure --status PASS prints active ZERO-001, FULL0/4 and QA source-drift BLOCKED; --assert-batch ZERO-001 EXIT0 allows work only on pinned test source; --assert-batch ZERO-002 EXIT2 explicitly refuses early advancement. Script AST + wired source-hook review PASS. No technical scenario pass was awarded.
- Explicit --advance-closure checks ALL four exact-SHA independently attributable technical signoffs and official source runtime alignment before changing active batch. It is currently BLOCKED. Later batch source smoke/inspection dispatch through agency_zero_control.py is guarded as well. Direct workstation testing must first invoke sequential assert and verify its exact source HEAD separately.
- This supersedes previous historical reports instructing advancement while the first original batch was still partial. Failures permit other independent SAFE tests within ZERO-001, never skipping ahead. If stage or operator access is not authorized, keep ZERO-001 BLOCKED rather than inventing a pass.

## Exact failed CI and latest diagnosis

- Hosted independent audit: https://github.com/itxsam57/hseverify-production-hardening/actions/runs/45603019052 on QA source SHA91702d8. Attempt1 terminal FAILED one generic critical full-regression command because Case Replay Chromium found 0 rubric spinbuttons where 2 expected. This is CI red, not evidence of an exploitable critical vulnerability. A targeted one-time SAME QA source local Chromium run finished raw TAP tests1/pass1/fail0/skipped0; logging wrapper threw AFTER execution and lost subprocess exit code, so not even a captured clean process exit. Raw proof retained; it cannot override failed hosted CI. Synthetic fixture credentials were deleted from private vault.
- Authorized same-source retry of failed hosted job initiated as attempt2, status IN_PROGRESS when this report was recorded. Do not claim a terminal pass; later check its actual terminal conclusion and retained artifacts. Do not weaken a failing test, bypass source drift or silently repin to QA917.
- The moving QA branch has unapproved changes in Company workforce export CSV safety and Company Workforce table headers relative to frozen pin7ff. The official control rejects drift. They need isolated design/source review and approved candidate integration with affected regressions; passing QA-only source tests cannot count for frozen pin.

## Private evidence and next closure action

- Private combined gate/CI receipt SHA256 1960a30c2d5ba6fcab3e6ca9124e3eb695205098b908c0dba2cb0f874e60e66a under /home/ubuntu/work/.hse-qa-tmp/agency-zero-sequential-closure-001/ZERO001-owner-sequential-closure-enforced.json. Local QA917 attempt raw log SHA256 0000ab5514710d1ede6361a5b8423cc2ebc2f0d3290d14e89469369a091e1239; immutable reconciliation JSON SHA256 7947beed72c625d5358dfc125a795ac53474d7c5b04358448660cd72e28c2edb. Existing M1.01.02/M1.01.04 raw PG16 and stage restore receipts remain preserved under previously recorded paths. Private secrets NOT committed. All four original scenario verdicts remain unchanged.
- NEXT = ZERO-001 ONLY. Check hosted audit attempt2 terminal status and exact failure cause, then obtain signed exact-approved-source build-to-running-stage attestation and reviewed rollback/offsite backup evidence on a separately authorized isolated stage. Complete missing E/C/R signoff per M1.01.01-.04. Never advance ZERO-002 before 4/4 verified, and never touch shared stage or production without explicit operator authorization.

### GitHub Actions enforcement update

- The existing governance workflow now invokes the sequential closure gate on each QA policy change; its paths include the new gate script. The manual five-case workflow rejects ALL and later original batch selection, and runs no parallel original batches. The standard matrix command forbids ALL to avoid bypass. These are QA governance changes only; hosted verification of the new workflow on moving QA HEAD is not yet terminal green because source runtime drift is still blocked.
