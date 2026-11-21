# M1.02.01 — real local Chromium public navigation and contact/demo receiving workflows

**2026-11-10 · SCOPED QA EVIDENCE · NOT FULLY VERIFIED · RELEASE NO-GO · FULLY VERIFIED 0/218.**

Source QA SHA: `73b63e4d4f7d502c5e7b813bae5955d601270d9d`; worktree `hseverify-m10201-public-nav-20261110`; branch `qa/verify-m10201-public-nav-20261110`. This test starts from the active signed QA merge but uses a disposable local PGlite database, local Next development server and synthetic staff credentials, **not** protected final staging or real providers.

## What was exercised with actual controls

- **Public navigation, real Chromium:** desktop **1440px**, mobile **390px** and narrow **320px** viewport; actual click through How it works, Workers, Companies, Verify, Contact and Sign in; both Worker and Company registration forms; selection and six Worker, Company, Verifier, Assessor, Admin and Root sign-in forms; no page-wide horizontal overflow; keyboard Tab/Enter reaches Contact. Initial desktop/390 test passed; expanded 320 test passed.
- **Contact, demo, credential concerns:** real 390px Chromium form inputs, wrong/short contact message rejected without losing draft, successful contact and demo submit with receipt, one valid public credential verification leading to a real concern intake and confirmation.
- **Receiving-side verification:** authenticated Admin and Root actually opened the private Contact & demo requests queue and saw both inquiries. Authenticated Worker direct visit to Admin's inbox routed to Access Denied; signed-out browser redirected to Admin login. Actual persisted DB rows: exactly two public inquiry records, one credential concern, two `public_inquiry.received` immutable audit events.
- **Injection/HTML trust boundary:** real contact submission with synthetic `<img src=x onerror=window.__hseInquiryXss=1>` payload. Both Admin and Root inboxes display the complete message as **text**, not executable DOM; no unintended image element and no JavaScript sentinel. PGlite persists the exact text unchanged. This is a **targeted stored-HTML XSS negative** only, not a full application XSS audit.
- **Native negative tests:** 4/4 pass for validation, duplicate nonce/purpose binding, shared IP and email quotas, required audit failure rollback and retry, immutable audit, staff-only queue and current role/session authority checks (including revoked/locked staff and other roles).
- **Fixture hygiene:** browser inquiry test no longer writes or reads the globally shared `/tmp/independent-audit-credentials.json`, instead uses a private credentials file within its disposable PGlite fixture, removed after test. This avoids concurrent test collisions; it does not activate production credentials.

## Test receipts

Local command groups `public-inquiry-native` **4/4 PASS**, `design-system-chromium` **1/1 PASS**, `public-navigation-chromium` **1/1 PASS**, `public-inquiry-chromium` **1/1 PASS**. Expanded narrow-navigation 320/390/desktop retest **1/1 PASS**, staff-side stored-HTML XSS retest **1/1 PASS**; strict TypeScript PASS, ESLint exit 0 (9 existing warnings). All **6 primary and supplemental test command runs** exited 0 and include **9 passing test executions / 7 distinct tests**. Tracked outcome receipt: `docs/qa/evidence/M1_02_01_QA73B_LOCAL_RESULTS.tsv`; full actual `.autopilot/artifacts/M10201_QA73B_*.log` in this isolated worktree. The original tests remain meaningful and the extra negative coverage is committed for future replay.

Dedicated GitHub Actions workflow `.github/workflows/m1-02-public-nav-inquiry.yml` runs the native and actual Chromium tests on the exact pull-request SHA, 320/390/desktop and logged Admin/Root receiving state, publishing logs even on failure. Requires actual GitHub CI proof before counting it as merged or green.

**Guarded RED → GREEN scope:** A deterministic check of the unchanged QA73b browser-test sources failed because the original public navigation test did **not** contain the 320px viewport requirement (baseline RED log `M10201_BASELINE_COVERAGE_RED.log`), and the inquiry test referenced a globally shared `/tmp` credentials file. The updated tests cover 320px and use a disposable private credentials path; an explicit source-coverage assertion passed (`M10201_COVERAGE_GREEN.log`) and actual Chromium tests passed. This is a **missing regression coverage/test fixture isolation defect**, **not** a demonstrated live application vulnerability or production XSS exploit.

## Still missing — mandatory blockers

Actual protected final staging candidate, real configured external delivery for follow-up (human response, live email/meeting), production proxy source-IP trust/rate limiting, final-SHA all-role/UI/API abuse and accessibility verification, real incident/restore/load, complete penetration testing and Owner UAT. Active QA branch previously reported `protected=false` with no repository rulesets returned (checked 2026-11-10); **release governance remains open** even if QA workflows pass.

**M1.02.01 NOT_FULLY_VERIFIED; 0/218 release-certified.** Local browser/navigation and receiving-state success is not proof of full cross-role, final-staging provider delivery. Next: guarded commit, exact committed SHA retest, push QA PR, inspect all GitHub checks and signed merged SHA; then first unfinished actionable M1.02.02 or upstream release-governance blocking checks.
