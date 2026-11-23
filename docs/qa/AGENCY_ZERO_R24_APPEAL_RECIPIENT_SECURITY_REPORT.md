# ZERO-R24 — Appeal recipient, private evidence and withdrawal security revisit

**Frozen application source:** `7ff30ea140a5145e5d5ba761f7c7aef24c895269` (unchanged). **Original related scenario family:** `M3.07.01`, `M3.07.03`, `M3.07.04` in ZERO-050. Exactly **five distinct existing source test workflows** in one bounded batch; **SCOPED PASS 5/5 (process exit 0; TAP pass 5 / fail 0 / skipped 0)**. **No new technically fully verified original scenario; 0/218 FULL.** The earlier ZERO-050 positive Worker→Admin appeal browser/source results were **not rerun**.

## New scoped source cases (all actual PGlite/service tests)

| R24 | Source test | ENGINEER result | CYBERSECURITY result |
|---|---|---|---|
| 01 | `Original appeal submission and reasoned review retain next-actor and Worker delivery intents` | Original Worker appeal creates immutable `appeal.submitted` outbox; independent Admin reasoned review creates `appeal.updated` event, with successive versions 1→2 | Conflicted original decision Admin reviewer denied; submission history unchanged |
| 02 | `Current recipient revocation suppresses original event email without changing the submitted business record` | Reproduced a retained evidence-submission event with claimed email job | Deactivated recipient blocks provider call, persists delivery `suppressed`, original submitted evidence remains unchanged; **this is the original evidence event, not an appeal-specific revoked-recipient proof** |
| 03 | `Decision and credential notifications resolve real owned Worker records and foreign cases stay unavailable` | Actual decision and credential event notices link to owned Worker assurance case and passport | Foreign Worker and Admin cannot read owned Worker assurance case; revoked Worker session denied |
| 04 | `Owned appeal evidence reaches independent Admin as exact retained bytes and denies changed or foreign authority` | Worker evidence response keeps exact immutable submitted version, scanned private object bytes, canonical Admin and Worker notice/email recipient intents, Admin authorized private no-store preview | Foreign appeal/request/file and original conflicted Admin denied; altered stored bytes rejected; later draft cannot replace submitted bytes; revoked Admin session denied; terminal review suppresses stale follow-up recipient claims |
| 05 | `Withdrawn appeal removes followup interview mutation authority without changing the original case` | Real appeal withdrawn while Admin-requested follow-up interview exists; interview state becomes `CANCELLED` | Assessor cannot claim cancelled interview; original underlying case remains authoritative |

**Private raw evidence:** `/home/ubuntu/work/.hse-qa-tmp/agency-zero-r24/R24-five-appeal-recipient-and-evidence-security.log`, SHA256 `2514b11f9cad70ad1fcccab1cf8973379f3c4dfb607f2f3468333519ec6d500e`; 69.0 sec, exact five named TAP passes, real subprocess exit0. Receipt `R24-five-appeal-recipient-and-evidence-security.receipt.json` retains command and SHA.

**Source SHA256:**
- `tests/platform/assurance-event-notification-producer-runtime.test.mjs`: `992fbd368e90acdc216ded638b6e8c20323c5a0a597b434f0987f38ee85b456f`
- `tests/platform/credential-appeal-evidence-consumer-runtime.test.mjs`: `798348a276dcc8b480291771734fc4ed10acc00d9affe5acea56c5a97daba0c3`
- `tests/platform/credential-appeal-interview-runtime.test.mjs`: `190c3eb2c972f361bfd03344fa9d9e365012752c48f51c6b694cbfa45e9127d3`

**ENGINEER — SCOPED PASS:** Real source services and database constraints were exercised, event projections and linked private bytes verified, source code unchanged. No new browser action centre, portal notification bell or independent protected staging journey this batch.

**CYBERSECURITY — SCOPED PASS:** Conflicted and foreign actors, revoked sessions and recipient, modified secure object, withdrawn appeal interview and stale source actions rejected under isolated fixtures. No full penetration test, real production email/API/storage contract or live all-recipient matrix.

**REVIEWER — SCOPED PASS (not independent full certification):** Selected five source test titles match five observed TAP pass lines and exact hashes; original ZERO-050 positive results preserved, not double-counted. A Company-visible appeal case was **not** demonstrated by any of these five tests; authorized Company appeal visibility remains explicitly OPEN. Other outstanding: end-to-end Worker/Admin/Company dashboards, notification bells by recipient, appeal outcomes/replacement credentials, live email, full negative/security/load/accessibility. **0/218 TECH FULL, owner testing not ready.**

**Parallel hosted audit:** [45189020158](https://github.com/itxsam57/hseverify-production-hardening/actions/runs/45189020158) on separate R21 QA test-only SHA `08e47344c417df198e065945510df98f1329661e` was **IN_PROGRESS** in final full regression gate at last inspection. Do not equate local five source passes with a hosted full audit pass.

**Next:** Save under guarded QA-only branch, do not merge/deploy/repin. Check hosted audit terminal artifacts, then investigate actual authorized Company appeal visibility and notification receiving in another bounded, independently executed batch of at most five. Preserve frozen 218 IDs, 37 groups and 58 original batches.
