# ZERO-R25 — Company portal explicit appeal visibility source-contract gap (one negative source check)

**Original related workflow:** M3.07.04 / M3.07.03 authorized Company appeal visibility and recipient updates, **one distinct source-contract check in R25**, **FAIL / UNVERIFIED**, not a vulnerability or comprehensive UI test. Frozen candidate application SHA `7ff30ea140a5145e5d5ba761f7c7aef24c895269`, no product or production mutation.

## Exact observed static check

Read all **45** `.ts`/`.tsx` files under `src/app/company`, including **23** `page.tsx` routes, and searched the source text and route paths for an explicit `appeal` reference. **Zero matching Company UI source files and zero appeal-labelled routes**. The read-only QA source contract check deliberately failed, **process exit 1**, at `assert matching or explicit`. Private original failure: `/home/ubuntu/work/.hse-qa-tmp/agency-zero-r25/R25-explicit-company-appeal-ui-source-red.log`, SHA256 `ac57505d1ad58cdcf2a8f727e6439900365e612c199551ae4713b4e25a5730df`. Exact Company UI source-tree digest (path + SHA of each file) `3d8082d71f50817635a659771dbc68a35d1b256a1e8119f8f335cac3676ca9fd`.

**Interpretation limited to direct source evidence:** Explicit Company appeal-labelled entry points, details and actions are not apparent in the inspected portal UI. **This does NOT prove** an authorized Company cannot see an indirect updated credential/assurance status, nor does it establish that an employer is entitled to appeal reason or evidence. Role and privacy policy must determine **which appeal-related status can be exposed**, then a synthetic Company-linked Worker appeal must be driven through a real browser and API to prove allowed visibility and tenant denial. Do **not** add unauthorized appeal reason/file disclosure merely to make a test green.

**ENGINEER — FAIL / OPEN:** Explicit Company appeal-labelled UI source-contract check failed. No actual Company browser rendered in this check.

**CYBERSECURITY — NOT VERIFIED:** No demonstrated cross-tenant disclosure or exploit. Company/Worker privacy boundary, authorized minimal appeal lifecycle status, foreign Company and revoked membership access remain to be tested independently.

**REVIEWER — OPEN:** One precisely scoped read-only negative check with stored process exit1 and SHA; not counted as success or a complete source/UI feature audit. Original M3.07.03/04 remain TECH FULL 0.

**Relationship to R24:** R24’s separate five **PASS** PGlite appeal-related security tests are preserved and unchanged. R25 is **separate batch of one source-contract check**, not a sixth item in R24.

**Next:** After consulting the actual Company authorization/domain policy, test a complete owned Company-linked Worker appeal response from Worker→independent Admin→Company permitted status, denied for foreign Company/unauthorized users, including notification bell, history and absence of sensitive appeal evidence leakage. Do not implement or assert a Company entitlement beyond documented authorization. Leave production unchanged and original 218 status at **0/218 TECH FULL**.
