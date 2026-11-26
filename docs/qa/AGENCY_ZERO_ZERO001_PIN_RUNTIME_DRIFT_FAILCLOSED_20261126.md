# ZERO — approved source pin runtime scope failed closed

Batch ZERO-001/058, original M1.01.03, TECH FULL 0/218, ZERO001 FULL0/4, owner ready NO. QA-only draft, no production mutation.

Actual defect: the original approved-source validator returned PLAN VALID exit0 while the reviewed product pin 7ff30ea differed from QA HEAD in PostgreSQL migrator helpers and preview runtime. Previously omitted paths were scripts/lib/database.mjs, scripts/lib/migrations.mjs, scripts/smoke-preview.mjs.
Baseline 3 distinct bounded source-contract cases: 1 pass, 2 fail, exit1; raw SHA256 aae17a98b1869d3799bae3bd985618a161a0ee2e143fd808ec0f889da9611ac8.
Narrow guard change: add scripts/lib/ and scripts/smoke-preview.mjs to app runtime diff coverage. This is NOT a product patch or a source repin. Original same 3 contract cases now 3/3 pass, exit0, SHA256 044fb66344cb9ba3d30c175406bafd872f6fafb9ce20aa1d4eee7204303ae531.
The actual complete agency plan validation now exits2 (correct FAIL CLOSED), reports all three unapproved paths, SHA256 5a31253a88c052e5f1f2951fed9ad6cd593a25a380b7eb7ffc77ee0e0c8df947. Do NOT remove the guard to green CI. The approved source pin must be reviewed and repinned with affected tests, or build exact original app source. All 58 original batches remain unchanged.

ENGINEER: scoped PASS. CYBERSECURITY: scoped fail-closed PASS, full penetration pending. REVIEWER: AI reviewed raw before/after and denies any original TECH FULL.

Private ECR /home/ubuntu/work/.hse-qa-tmp/agency-zero-sequential-closure-001/ZERO001-M10103-PIN-GUARD-RED2-GREEN3-THREE-REVIEW-ECR-20261126.json SHA256 9825d6744874a7cb999994f4371a999a911402f108d29a44afc5e311cdc80c2f. Next: reviewed application source candidate, protected identical-SHA HTTPS stage and all original ZERO001 engineer/security/reviewer/adapter gates.
