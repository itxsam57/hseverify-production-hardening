# M1.11.03 — actual Worker skill notification bell/Open in Chromium (2026-11-19)

**Signed QA baseline:** `f7479b9dc0698d347de8da4debf3a0459ecfc296` after PR164; all **70/70 exact-SHA GitHub workflows PASS**. New browser source not yet executed; **0/218 fully verified, NO-GO**, 4,975 original planned final0.

## Scope and expected evidence

- One **controlled synthetic-only** PGlite database built by existing `policyInterview` fixture, actual `WorkerEvidenceService`, independently calibrated real `EvidenceReviewService`, original immutable outbox event producer and registered notification projector. All provider/personal data synthetic.
- Real signed-in Worker at 320/390/1440 views actual original skill `CHANGES_REQUESTED` notification in `/worker/notifications`, clicks the real **Open** form button to the exact `/worker/evidence#recordId` and sees the independent review state; no horizontal page overflow. Private Verifier reason does not leak in summary.
- A logged-in Verifier, separately authenticated foreign Worker and signed-out browser cannot access the copied notice and/or original Worker's evidence record. No false authorization from a copied hash link. Previous native test already verified direct notification-ID denial; browser adds real UI.
- After graceful shutdown of the controlled Next session, Worker submits corrected v2, independently calibrated Verifier approves and genuine notification projector commits. Worker at 320px opens dashboard **bell** then actual **Evidence review recorded** button, reaches own record, views APPROVED. Checks 320/390/1440 notification list responsive and read state.
- After graceful shutdown, original DB must show two distinct source-version-bound decisions and actual `notification.read` audit **one per clicked notification**, no duplicate or lost state, zero browser 500/page errors.
- CI workflow `.github/workflows/m1-11-03-skill-notification-open-chromium.yml` demands 1/1 new actual Chromium and 1/1 unchanged adjacent `all-role-notification-workflow.browser.test.mjs` with four explicit receipt markers. Both original raw CI logs retained for 90 days; exact PR and merged QA SHA separately run. **Do not claim passed until remote raw evidence proves it.**

## Counting and release blockers

The frozen scenario is still **NOT_FULLY_VERIFIED**. New source identity is the **1,608th test**; previous genuine PR164 skill native notification exact-SHA CI now gives **1,434/1,608 historical green**, new browser NO_PASS_LOG_EVIDENCE pending hosted run. 4,975 old planned 693 partial/97 uncertain/4185 no precise link, final0; release still 0/218. Remaining are direct API/token/tenant abuse, browser keyboard/expiry/retry/race coverage where applicable, provider email/SMS/storage/scan, exact final protected staging, independent comprehensive pentest, realistic load/restore and Owner UAT. Never treat a scoped synthetic pass as certification.

**Next exact command:** guarded commit/push new browser + original strict evidence index; require hosted Chrome log 1/1 four markers plus original all-role regression 1/1; download SHA256. Fix any red, merge only after green, then verify all exact merged SHA workflows. Preserve shared PostgreSQL and other worktrees; no local server needed.
