# ZERO-R18 — Authenticated Company Action Centre mixed-status browser

**Pinned app SHA:** `7ff30ea140a5145e5d5ba761f7c7aef24c895269`. One original-related M3.04.03/.05 test/workflow, **1/1 SCOPED PASS** on actual signed-in Chromium. No TECH FULL award.

## What actually passed
- Fresh synthetic Company fixture + isolated PGlite four assurance Cases: Approved Forklift L2, Review pending Forklift L2, Conditionally approved Confined Space, Closed Retired Target; one overdue Company action.
- Real Company browser authenticated session: **4 active orders, 3 active cases, 1 Company approval, 1 overdue**, `Approved: 1`, `Review pending: 1`, `Conditionally approved: 1`, Forklift gap **1/2 = 50%**, Closed target absent.
- Authenticated UI at **320px, 390px, 1440px** without horizontal overflow or page errors.
- After stopping first embedded PGlite-backed Next server, an independent DB writer changed pending Case to Approved and its action to resolved, **exact update count 1 each**; a fresh Next process and fresh real Company login show **Approved: 2, zero approval/overdue, Forklift 2/2 (0% gap)**. Cold persisted-state read demonstrated; **live same-process refresh NOT demonstrated**.

**Diagnostic red retained:** The first R18 attempt updated a *separate embedded PGlite instance while the first server remained open*: the original server still displayed 1 approval/overdue. It was a test-environment snapshot visibility limitation, not confirmed production PostgreSQL defect. Private failing log SHA256 `3e8eef1c8081dbb2080704341cd5e077d795b7ac04353b1107918ecfd59671ba`, exit1. One corrected retry cold-restarted server and PASSED, followed by exact repeatable checked-in source retest.

**Final repeatable test:** `tests/browser/m3-04-company-action-centre-mixed-status.browser.test.mjs`, source SHA256 `997731ec0d41353b4c63cd37020bdc91a567637682ad7c49fe63c469b1a62bdd`. `node --test --test-concurrency=1 tests/browser/m3-04-company-action-centre-mixed-status.browser.test.mjs` **1/1 TAP PASS, process exit 0**, ~39.1s. Private raw log `/home/ubuntu/work/.hse-qa-tmp/agency-zero-r18/R18-mixed-company-browser-permanent-source.log` SHA256 `d34f91cf077b9aff7aaf60d992075ac190f9b0d69d2c129cd4450381d2e55315`. The original temporary cold-restart run also PASS, SHA256 `fdff1c92d4a81158389aed7126b089927b48df2636f81f99d1a4c86c7bc12219`.

**ENGINEER: SCOPED PASS.** Real signed-in Company browser with mixed data, responsive checks and authoritative persisted DB before/after isolated restart. Cases seeded via DB fixture (not Company UI producer). Not proof of hot real-Postgres refresh.

**CYBERSECURITY: SCOPED PASS only.** Closed record exclusion and existing tenant-bound screen. R17 separately covered signed-out denial/wrong-permission, but this test **does not** independently complete two-tenant BOLA, CSRF, XSS, revoked session or penetration tests.

**REVIEWER: SCOPED PASS, NOT TECH FULL.** Exact checked-in test rerun and hashes reconciled, initial red retained. Real Company action creation, authorized status changes and receiving Worker on live PostgreSQL plus independent security/adapter signoff remain open. **0/218 TECH FULL. OWNER TEST READY NO.**

**NEXT:** Guarded commit/push QA-only test and evidence; inspect new independent hosted audit [45178421779](https://github.com/itxsam57/hseverify-production-hardening/actions/runs/45178421779) on older SHA `8e8ee79` (does not include R18 test), then continue <=5 original related cases. No production/shared-stage mutation.
