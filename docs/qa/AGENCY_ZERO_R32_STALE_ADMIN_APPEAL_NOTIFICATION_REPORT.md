# ZERO-R32 — Terminal appeal obsolete Admin notification and revoked Admin session

**Original-related scenarios:** M3.07.03/M3.07.04 within ZERO-050. **One bounded related R32 batch: exactly two independently named PGlite/service test cases, both SCOPED PASS (2/2, process exit 0), NOT TECH FULL.** Frozen application SHA `7ff30ea140a5145e5d5ba761f7c7aef24c895269`, no application product, migration, auth guard, provider or production change. Isolated QA branch `qa/zero-r32-stale-admin-appeal-notifications-20261123` based on `752d4cfc37f9f4e82b1cab9bc08cfef6783af70e`.

## Two actual source cases

**R32-1: `R32 terminal rejected appeal removes obsolete independent Admin notice without deleting retained history` — PASS.** Created a real credential with the existing approved decision producer and mapped Worker ID. Separate independent Admin account/session had a genuinely projected `appeal.submitted` notification with exact appeal target, while Company had none. Original conflicted decision Admin was refused as a reviewer. The independent Admin then made a reasoned **rejected** appeal outcome (version 2); the obsolete original submitted-appeal notice immediately disappeared from independent Admin's active list, unread count reduced by one, direct `findForPrincipal` and `markReadForPrincipal` returned null. The original stored Admin notice remained unread/unchanged and the immutable appeal event history contained `submitted→rejected`. Original `appeal.updated` outbox was projected and delivered to Worker, not Company. No old-history deletion and no Company private notice.

**R32-2: `R32 revoked Admin session cannot list, count, Open or read submitted appeal notification` — PASS.** Original credential and Worker appeal source event created via actual services. A current Admin session first viewed its correct appeal notification. After durable `auth_sessions.revoked_at` on that Admin session, all notification list, unread count, direct Open/find and Mark Read were **denied**; original notice stayed stored unread and Worker appeal was still `submitted` (version 1). Worker remained an eligible recipient. This tests actual repository authorization, not merely UI labels.

## Exact evidence

- Command: `node --test --test-concurrency=1 --test-name-pattern=R32 tests/platform/assurance-event-notification-producer-runtime.test.mjs`
- Private raw TAP `/home/ubuntu/work/.hse-qa-tmp/agency-zero-r32/R32-terminal-appeal-and-revoked-admin-first.log` SHA256 **`e9e122153a41f9d8b20e59952f9074b62fe22d03219ab94404ba1b83cdbe1be5`**
- **Process exit0, TAP 2 pass/0 fail/0 skipped, ~27s**. Receipt `R32.first.receipt.json` in same private directory.
- Test source SHA256 **`95f8238e47383d28ceabc5bea3690223d8c6ef8664eaaa52080ed321358d86c2`**.
- `node --check` PASS; changed-file ESLint **0 errors / one pre-existing unused `DatabaseEmailDeliveryRepository` warning at line 137**, not introduced by R32. `python3 scripts/agency_zero_control.py --check` PASS, frozen 218 original IDs, 37 groups, 58 existing bounded batches and original app SHA unchanged.

**TDD baseline missing-coverage RED:** A read-only source check against `git show HEAD:tests/platform/assurance-event-notification-producer-runtime.test.mjs` deliberately returned **exit 1** because neither new R32 test existed in the pinned QA baseline (coverage absence, **NOT** an application runtime defect). Guard-preserved `.autopilot/artifacts/zero-r32-absent-terminal-and-revoked-admin-test-coverage-red.log`, SHA256 `95fa074f06a835a6bba9cc90bc2d2d7b51b1de1f06642a9602ddc78d6ea83440`. Both new tests then ran and passed without altering app code.

**ENGINEER — SCOPED PASS:** Real authenticated repository state transitions, original credential and appeal source, actual projector/notification repository and end-to-end immutable historical state were checked through isolated PGlite. No browser test in this batch; R31 separately covered genuine Admin bell Open/read on an active submitted appeal.

**CYBERSECURITY — SCOPED PASS:** Independent-review conflict denied; terminal original-source recipient ineligible and direct stale notice access refused; revoked Admin session rejected for both reads and mutations; stored notification and appeal histories unaltered; Company excluded. No claim to full pen test, external email, cross-tenant production security or live adapter contracts.

**REVIEWER — SCOPED PASS, NOT FULL:** Exactly two case titles and TAP success lines, private log SHA/receipt, unchanged pinned app, source/test-only patch and existing warning. The R31 actual Admin notification bell test remains separate, not double counted. Original M3.07 scenarios remain **0/218 TECH FULL overall** until full genuine browser/role/audit/provider/reviewer evidence on common approved QA SHA.

**Hosted full audit:** [45213941977](https://github.com/itxsam57/hseverify-production-hardening/actions/runs/45213941977) on different R28 QA source `0328698b5ca01a9f1c8568d7d7515a90638055c6` is still **IN_PROGRESS** in `Existing full regression gate cross-check after independent audit` at the R32 test checkpoint. It does not cover this newly written R32 source test. Final success MUST be checked against terminal `FINAL-AUDIT.json` + raw regression log; no pass assumed.

**NEXT:** Guarded QA-only commit/push and a draft PR; inspect hosted independent audit terminal evidence; continue bounded unrelated incomplete original scenario batch. New test-source digest must be reconciled *after* approved QA integration, preserving original 1,610 historical source-case identities and prior 218 record links. **0/218 FULL, OWNER READY NO, no production changes.**
