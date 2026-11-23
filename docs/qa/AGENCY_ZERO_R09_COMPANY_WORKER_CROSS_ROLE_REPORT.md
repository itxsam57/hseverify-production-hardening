# ZERO-R09 — Company registration codes and Worker placement (two original workflow units)

**Date:** 2026-11-23 UTC. **Frozen application runtime SHA:** `7ff30ea140a5145e5d5ba761f7c7aef24c895269`. **Tested QA code HEAD (before this report):** `0d7ed722c49789525721b3d924b3375c4ff56d06`. All tests used an isolated disposable PGlite DB and real headless Chromium/localhost Next.js; no live provider, production, shared stage or customer data changed. **2/2 selected scoped source cases PASS; 0/218 TECH FULL.**

| Frozen ID / actual test | Observed functional+receiving result | Scoped security result |
|---|---|---|
| `M1.10.03` — `tests/browser/m11003-company-code-usage-defaults.browser.test.mjs` | Company owner rejected invalid usage/expiry; created a bounded code with Site/Department defaults; two real Worker browsers redeemed; Company observed exhaustion; Worker A/B links and DB/audit persisted. **SCOPED PASS 1/1**. | Third Worker exhaustion denied, rightful replay idempotent, revoked/expired/tampered/anonymous code denied; responsive 320/390/1440 checks |
| `M1.10.05` — `tests/browser/m11005-worker-placement.browser.test.mjs` | Company moved a linked Worker to new Site/Department; Worker received updated scoped history in actual Chromium; DB confirmed one valid change, correct audit actor/scope. **SCOPED PASS 1/1**. | Forged Site ID denied with zero DB changes; replay idempotent; 320/390 Worker history usable |

**Environment triage (not hidden):** First `M1.10.03` attempt FAILED *before workflow execution*, because Turbopack could not resolve `next/package.json` through the worktree's symlinked `node_modules`. Its startup error `ENOENT build-manifest.json` is a **TEST_ENVIRONMENT** failure, not a proven product defect. SHA256 of original failure log `ed6a1779ee8e86401f5aec6427e05b06532ecfd233d89014719ffc68afcd7b27`. The symlink itself was unlinked without touching the other worktree, and a fresh `npm ci --no-audit --no-fund` in this isolated worktree installed 371 locked packages. **One corrected setup retest:** original exact test 1/1 PASS, raw SHA256 `cd5f5331c7a36c9b11e7e9ae71baa5e118dd598f5fe77fb27ded0ec744179824`. `M1.10.05` first attempt 1/1 PASS, SHA256 `7d56f9679e06192e92ce5b3224af463ed500f7bcea9b5c96028669793cb1ed67`.

**ENGINEER — SCOPED PASS 2/2:** Real Company and Worker browser forms and authoritatively persisted synthetic DB/audit passed. These are *additional UI/receiver variants* not covered by the selected ZERO-013 cases (M1.10.03 prior PG16 last-slot race; M1.10.05 prior ending relationship). No other source case rerun.

**CYBERSECURITY — SCOPED PASS 2/2 targeted:** Code enumeration/replay/expiry/revocation denials and forged Site/Department denial. Cross-tenant attack-surface breadth, CSRF, authenticated pentest, brute-load and real provider adapters are still incomplete.

**REVIEWER — NEEDS EVIDENCE:** Individual source/browser assertions and hashed logs reviewed by this AI, **not an external independent accredited reviewer**; full accessible design/visual regression, manual security review, Company B/Worker C misuse and adapter contract finalization remain outstanding. **Do not certify either original scenario fully.**

**Private original logs:** `/home/ubuntu/work/.hse-qa-tmp/agency-zero-r09/` has `M1.10.03.first.log`, `M1.10.03.recheck.log`, `M1.10.05.first.log` and individual JSON receipts. No real account credentials or files published.

**NEXT:** Independently test `M1.10.04` wrong/unlinked Worker receiving another person's invitation and `M1.10.06` concurrent dual-employer UI as bounded R10 <=5 cases; keep existing ZERO-013 PG16 race evidence, don't repeat it. In parallel inspect terminal corrected independent full audit [run 45109434561](https://github.com/itxsam57/hseverify-production-hardening/actions/runs/45109434561) on exact QA test SHA. **OWNER TEST READY: NO.**
