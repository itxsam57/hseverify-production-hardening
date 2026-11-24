# ZERO-R35 — Accessible Company “Assurance” header, hosted audit failure diagnostic

**Original scenario family:** M2.13.04 — credential lifecycle across Worker/Company/public API/PDF. **One distinct original-related browser workflow** was re-executed in two local conditions for diagnosis; do **not** count two repeats as two independent scenarios. The 218 original scenarios, 37 groups and 58 first-cycle batches remain intact. **TECH FULL 0/218, OWNER TESTING READY NO.**

**Immutable application source:** `7ff30ea140a5145e5d5ba761f7c7aef24c895269` (no app, SQL, CSS, provider, security, production/staging changes). Isolated QA branch `qa/zero-r35-credential-accessibility-root-20261124`, based on R34 QA diagnostic branch SHA `ec52856bb568ecce042c2f331c23d9d39f0ee310`.

## Exact original hosted failure

Independent hosted [run 45229745087](https://github.com/itxsam57/hseverify-production-hardening/actions/runs/45229745087) on QA SHA `af725b7330cf5457c93b97762f1ad5484ee60aa2` ended **FAILURE**, full report verdict `DEFECTS_FOUND` with **one critical gate failure, zero high**. The generic failure is `existing_full_regression_crosscheck` exit1, **not a confirmed security exploit**. Its `tests/browser/credential-validity.browser.test.mjs` timed out waiting the original 15 seconds for an accessible and visible `getByRole('columnheader',{name:'Assurance'})` on actual Company `/company/workers`.

Actual fail-only R34 captured **HTTP200**, headings `Workers`/`Directory`, one `table.data-table`, native header texts including `Assurance`, document ready state `complete`, `nextjs-portal` present. This **proves the header text existed in the DOM**, not that the header or its accessibility role was visible. It does not yet distinguish an RSC streaming hidden ancestor, an active development overlay, mobile clipping, transient layout/role semantics, or other actual cause. Private exact artifact: `/home/ubuntu/work/.hse-qa-tmp/agency-zero-r34/audit-45229745087`; `FINAL-AUDIT.json` SHA256 `6fc66586b480f328d25351484951d124ebc7ccb0b6cc71e351391267602e1423`, regression log SHA256 `34cb54c9eba1fb6129c7f5ab92949e4052abe642b137cfd7b95c718add5f881e`. Autopilot V4 red receipt `.autopilot/artifacts/zero-r35-second-hosted-accessibility-header-red.json` SHA256 `bb46cfde06422b98d70cc0cdf33dcf3e6ae9a9e08b5aee0eada11a8118b03f44`.

## R35 scoped test and observations

**No product “fix” asserted yet.** In the existing `tests/browser/credential-validity.browser.test.mjs`, the original **15-second visible role assertion is unchanged and is still rethrown on failure**. Added fail-only, safe semantic/geometry diagnostics:
- Actual number of accessible columnheader roles vs native `th` nodes, role/native `isVisible()`, bounding box, `thead` accessibility snapshot.
- Header/ancestor computed `display`, `visibility`, `opacity`, `content-visibility`, `overflow-x`, `hidden`, `inert`, `aria-hidden`; 390px header rect, horizontal scroll, document visibility and Next overlay open dialogs.
- Diagnostic-only 1440px role/native visibility comparison, restoring 390px, **then throwing the original exception**. No arbitrary wait, extra retries, ignored check, simulated pass or user data output.

**Local real Chromium run on isolated QA source: 1/1 PASS exit0**, including original Worker dashboard, Company directory/exports, credential signed public API, QR and actual PDF assertions. At 390px, `roleCount=1`, native header visible, accessible role visible. Private log SHA256 `a8f64ac71b8c9ec0de7994eaf243dec71d389284dd5db2e2e972ab3939329e46`; source test SHA256 `c7dfe5a3f3d7afd7ccc77f72ae1c9b7174d69948664794402ade20b6fce72272`.

**Single-core controlled resource check of the same workflow: 1/1 PASS exit0** with `taskset -c 0` limiting its process tree to one of two available CPUs, duration ~116 seconds. Header `roleCount=1`, both native and role visible at 390px. Private log SHA256 `501f83d44ff7107179c5a93bddb33b522b9bacd75d3e02b4faab5f467c6ea051`. Passing under one-core restriction **does not rule out a full-CI-only scheduling, hydration, resource or DOM accessibility issue**. These repeated runs do not increase original scenario credit.

**ENGINEER — SCOPED PASS (diagnostic instrumentation), ROOT OPEN:** Original full credential browser test passes locally and with constrained CPU; no durable product fix or full hosted pass. Expanded diagnostics retain the exact original failed condition and expose actual layout/accessibility state on its next occurrence. Syntax, changed-source ESLint, TypeScript, `agency_zero_control.py --check` and diff checks passed.

**CYBERSECURITY — TEST CONTRACT INTACT:** Existing role, tenant, source-credential, public API, signature, PDF and privacy asserts were not weakened. No authorization change; full pentest and live adapters still missing.

**REVIEWER — HOSTED FULL GATE FAIL, NOT TECH FULL:** Exact twice-failing hosted regression remains authoritative over local green. The R35 diagnostic is test-only; no verified root cause, no owner approval. No original 218 scenario promoted.

**NEXT:** Guarded commit/push R35 QA-only diagnostic branch and create **draft PR dependent on R34 draft PR #220**, then dispatch a new **independent full hosted audit on the exact new R35 source SHA**. After terminal, download `FINAL-AUDIT.json`, `commands.tsv`, full regression log, and inspect `R35_ASSURANCE_HEADER_ACCESSIBILITY_DIAGNOSTIC` if failure. Do not automatically merge to production or re-pin the frozen application. Continue separate batches ≤5 while hosted run proceeds.

## Dispatched exact-QA-SHA hosted follow-up (not a pass)
**Draft QA [PR #221](https://github.com/itxsam57/hseverify-production-hardening/pull/221)** at guarded SHA `e61e69fa0962bd6f8aa5ae9f2bd3a4a203a5ab95`; [new full independent hosted run 45361516452](https://github.com/itxsam57/hseverify-production-hardening/actions/runs/45361516452) dispatched and **IN PROGRESS**. It does not validate other independent draft PRs and is not owner certification. Next read terminal FINAL-AUDIT.json, actual full regression log and fail-only accessibility diagnostic if needed.
