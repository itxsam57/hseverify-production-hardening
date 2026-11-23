# ZERO — five original QA batches 046–050: audited scoped evidence

**5/5 batches attempted; 17 frozen original scenarios; 17/17 selected source workflows now PASS after documented QA-only test correction and nested TAP reconciliation; 0/218 TECH FULLY VERIFIED. OWNER TESTING READY: NO.**

Pinned application runtime SHA: `7ff30ea140a5145e5d5ba761f7c7aef24c895269`. Test/QA files changed only to correct a response framing assertion, not product implementation or production/shared staging. All provider references in scoped tests are synthetic/test-only unless expressly noted.

| Batch | Family | Original IDs | Selected source result | Technical full |
|---|---|---:|---:|---:|
| [ZERO-046](AGENCY_ZERO_BATCH_046_REPORT.md) | Billing: checkout/credits/refund | 5 | 5/5 PASS | 0 |
| [ZERO-047](AGENCY_ZERO_BATCH_047_REPORT.md) | Billing: signed webhook replay | 1 | 1/1 PASS | 0 |
| [ZERO-048](AGENCY_ZERO_BATCH_048_REPORT.md) | Worker+Company reports/recovery/email | 5 | 5/5 PASS | 0 |
| [ZERO-049](AGENCY_ZERO_BATCH_049_REPORT.md) | Report content safety | 1 | 1/1 PASS | 0 |
| [ZERO-050](AGENCY_ZERO_BATCH_050_REPORT.md) | Appeals and reassessment | 5 | 5/5 PASS | 0 |

## Three-discipline evidence and boundaries

**ENGINEER — SCOPED PASS 17/17, full original acceptance not signed:** Real Chromium sandbox checkout/refund, cross-tenant invoice isolation, Worker and Company private report downloads, Worker appeal/Assessor interview, and service tests for funding budgets, refund ledger, immutable report generation, email outbox, and independent appeals. Source code quality inspected around worker export response and QA test. One test corrected after genuine 1/1 failure caused by assuming required `Content-Length` on chunked compressed response. No app module changed, and the corrected ORIGINAL browser source re-ran PASS.

**CYBERSECURITY — TARGETED PASS, FULL PENETRATION/ADAPTER TESTS PENDING:** Selected tests deny cross-tenant invoice/refunds, shared credit overcommit, forged/duplicate signed capture webhook, report payload/CSV formula abuse, conflicting appeal reviewer, and private export access. Live billing provider settlement/refund/webhook signature rotation, external email delivery, storage adapter failure, malicious files, full HTTP attack coverage, staging pentest, load and operational restore are not independently verified. App-wide open high/critical count UNKNOWN.

**REVIEWER — original scenario-to-evidence reconciliation completed, independent feature signoff pending:** Original 17 scenario IDs are unique and mapped to 17 selected source workflows, no more than five per batch. SHA256 raw logs are private on the QA workstation, not published. One report catalogue source workflow contains 17 nested checks: TAP 18/18 PASS; initially the generic one-TAP-test checker misclassified that clean result. No separate agency signed off full role/UI/adapter/security matrix. Full technical awards remain 0.

## Frozen historical-test-index hash dependency refresh (no history rewritten)

Because the existing Worker report QA test source was corrected, the offline original 218 test-source digest changed. We updated **one SHA256 reference only** in `docs/qa/evidence/MASTERPLAN_218_EXECUTED_TESTS.json`, and **one dependent parent-file SHA256 only** in `docs/qa/evidence/MASTERPLAN_218_LEGACY_216_OBSERVATIONS.json`. All original case identities, source titles, 1,436 old distinct green cases, 216 old scoped scenarios, 316 historical refs, all 218 scenario mapping and 4,975 preliminary slots were untouched. After this, the 218, 216, action-map and 4975 integrity validators passed. The application source SHA and frozen current candidate remain unchanged.

## QA-only correction and preserved failures

- **M3.06.01 initial FAIL:** The Worker browser test expected `Content-Length=234`, but a valid gzip/chunked HTTP/1.1 transfer omitted it. Source app sets Content-Length before middleware transforms HTTP framing. A separate diagnostic proved actual CSV/PDF/print bodies exactly matched private stored artifacts and passed 1/1. The test now checks Content-Length only when provided and not compressed, keeping all byte-for-byte and hash assertions. The ORIGINAL test was rerun **PASS 1/1**. Both original FAIL and diagnostic logs are SHA256-retained; no production/app runtime edit.
- **M3.06.02 original suite was already GREEN:** One parent workflow with 17 nested cases passed **18/18 TAP tests**, 0 failed/skipped, but the generic single-test result counter marked it unproven. Reconciliation changed the record to SCOPED PASS, without rerun or attributing 18 original scenario completions.
- **No LIVE provider confirmation:** simulated checkout/capture/refund, signing and local SMTP/HTTP transport or test-scoped provider responses are not production provider adapter proof.

## Important still-open original acceptance gaps

- Billing: external real provider webhook/settlement/refunds, subscription and enterprise unavailable-state correctness, recipient receipts, credit reconciliation under operational failure.
- Reports: every Worker/Company report kind with actual recipient UI state, mixed-status workforce counts, all permission/CSV/URI attack variants, real cloud storage and email/scheduled delivery.
- Appeals: eligible/duplicate/evidence validation matrix, all accepted/rejected/further-evidence/further-interview outcomes, final replacement credential PDF/public/company consistency across real reassessment.
- The prior `M1.11.02` independent Worker full review browser timeout (465 sec) and `M2.10.03` outdated query-only scoring mock remain open and were not silently marked green.

## Exact continuation

**NEXT `ZERO-051`** under the frozen 58-batch original plan. Keep ZERO-001–050 in the unresolved full technical / independent security / reviewer revisit queue. Original selected source PASS does NOT mean OWNER TESTING READY.

Primary register: `docs/qa/AGENCY_ZERO_EVIDENCE.json`; exact cursor: `docs/qa/AGENCY_ZERO_CURSOR.json`; source raw logs are private SHA256-bound artifacts.

Recorded UTC: 2026-11-23T02:16:45.912746+00:00
