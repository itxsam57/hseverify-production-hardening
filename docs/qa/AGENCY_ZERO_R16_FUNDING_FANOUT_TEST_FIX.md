# ZERO-R16 — Hosted independent audit 45112527041 terminal red and bounded billing fanout fixture correction

**Pinned HSE Verify application SHA:** `7ff30ea140a5145e5d5ba761f7c7aef24c895269`. **Original scenario mapping:** Funding workflow M2.01 and Company billing next-action bell M3.04; original historical `tests/platform/assessment-funding-notification-security.test.mjs#a3ca48699d62a050` is only an indirect text suggestion, **not direct 218-case evidence attribution**. This run is **1 distinct test case, baseline + targeted retry**, not two cases and not TECH FULL. Synthetic isolated PGlite, no production/stage/provider mutation.

## Hosted CI terminal result on workflow fix `88ba8ca5abefc82bc7c1c56a3acedc70eed21749`

[Independent audit run 45112527041](https://github.com/itxsam57/hseverify-production-hardening/actions/runs/45112527041): **COMPLETED FAILURE**. Poppler prerequisite installation **PASS**, formerly four failing credential PDF cases now **34/34 PASS**, but later full regression `test:funding-notifications` **27/28 PASS, one FAIL**.

- `FINAL-AUDIT.json` **DEFECTS_FOUND**: 1 critical (generic CI `existing_full_regression_crosscheck` command exit1), 0 high, 14 medium, 61 low, 64 info. JSON SHA256 `dd3e243f949527f1ccedaf3909a0a4a5bfe8fbbb4d7922743c9877e0740603a0`. Full regression log SHA256 `e1347d90fd03036fc7af461d850fa558a56698795af7ba1bc563b448a2c39079`, private `/home/ubuntu/work/.hse-qa-tmp/agency-zero-r16/ci-final-88ba8ca/`.
- Red exact source case `One real request fans out only to live owned billing members and foreign approval stays denied` at `tests/platform/assessment-funding-notification-security.test.mjs`: fixture `addMember({revoked:true})` created an **already revoked Company membership** and then called production `AuthAccessRepository.insertSession`, which correctly rejects session creation unless Company membership is active. This is a **test-fixture ordering defect**. It is *not* proof that revoked members could log in or that actual product authorization is broken.

## Isolated evidence and correction (one original source case identity)

- Local **baseline RED reproduced** (test exit1, 0/1): SHA256 `eb5b1ce918812165ef2585f166dc8c0a695bd5c68d69f61cfe8405876c7e81a8`, private `funding-fanout-baseline-red.log`.
- Changed **only** `tests/platform/assessment-funding-notification-security.test.mjs` fixture `addMember`: insert active Company membership, create genuinely valid active Company session, **then update membership to `revoked`**, so later real funded event delivery verifies the original live authorization boundary. No product code, permission guard, CI assertion, notification recipient expectation or test title changed. Other deny/disabled/foreign fixture cases remain unchanged. Source before SHA256 `1fe6b47b39c3a6c488dd3865203db3f73ab8640fc6e5abfc29da81ec2d21a2f8`, after SHA256 `9fb19d4f4998f6ed141984860af595441a2509709b4cf479f25751104e07cc4e`.
- Local **targeted PASS 1/1**, process exit0, SHA256 `feeaef29f38936836704ec0a9d7224ababffb738d69990c3cffdbec61f9bde45`, private `funding-fanout-fixed-focus.log`. This case exercises Worker funding request, foreign Company denial without persisted side effects, notification fanout only to two live authorized billing members, excludes viewer/manager/overridden/revoked/disabled/foreign members, inbox read/click scoping, role ceiling and revoked billing action behavior.

## Discipline reviews

**ENGINEER: SCOPED PASS (focused).** Genuine platform auth session rule remains active and rejects invalid revoked-session issuance. After legitimate login→revocation sequence, the original full fanout test passes; no application modifications. Broader release regression check separately tracked and not counted in R16 bounded batch.

**CYBERSECURITY: SCOPED PASS.** No weakened login or membership check; after revocation the old session is unusable for delivery/reading. Foreign tenant approval denied, unauthorized member notifications excluded. Not a complete independent pentest.

**REVIEWER: FOCUSED TEST CORRECTION APPROVED, FULL VERIFICATION BLOCKED.** Source change matches exact stack and failure rather than masking. Prior historical evidence and 218 IDs unaltered; one selected case cannot certify original full workflow or external delivery. Owner testing not ready.

**Separate local regression gate checkpoint:** First `npm run test:funding-notifications` wrote complete TAP summary **28/28 pass, 0 fail**, but outer process wrapper hit its 300-second timeout and recorded **exit 124**; raw SHA256 `4466333632910224441db32de75b9870d36bff0a0b449d161758213cb0e3209c`. A second execution with 650-second timeout and explicit child-process result capture is running at `/home/ubuntu/work/.hse-qa-tmp/agency-zero-r16/funding-notifications-full-confirm.*`. **Do not say full release gate succeeded until process exit 0.**

**Follow-up:** `npm run test:funding-notifications` all 28 tests is an independent **release regression gate**, not part of R16 <=5-case batch. At report creation execution was in progress; record final result separately. Then guarded commit/push to draft PR #207 and dispatch new exact tested SHA full independent hosted audit. **0/218 TECH FULL.**
