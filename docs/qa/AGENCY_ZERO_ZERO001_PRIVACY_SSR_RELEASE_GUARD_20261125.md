# ZERO-001 — hosted CI privacy-sharing denial regression (workstation evidence)

**State:** isolated test-only fix **SCOPED PASS**, hosted exact changed-source full audit **NOT YET RECHECKED**. Approved application pin stays `7ff30ea140a5145e5d5ba761f7c7aef24c895269`. Original batch ZERO-001 is 0/4 TECH FULL; original Masterplan is 0/218. Vercel is unrelated; no production or shared stage writes.

**Observed RED:** Independent hosted full audit [run #45686950745](https://github.com/itxsam57/hseverify-production-hardening/actions/runs/45686950745) terminal failure, exact parent SHA `15887031b1ed350ebdcaf8ee40d0d8e1de75c2dd`. In `tests/browser/privacy-sharing-restriction.browser.test.mjs:85`, a forged Worker POST to Admin privacy produced HTTP 400 instead of the required HTTP 303 redirect to `/access-denied`. Final audit became 1 critical, 0 high; full regression exit 1. Same unmodified test at same SHA passed 1/1 locally: root cause is not proven, and the security denial is not waived.

**Bounded test-only change:** collect Admin SSR Server Action form fields from a *real authenticated browser* with JavaScript disabled, including the `$ACTION_ID_` marker, before forging Worker or stale-Admin POSTs. Missing marker fails the test rather than sending malformed 400-request body. Kept genuine status 303/redirect/403, Admin execution, public share revocation, revoked-session, and durable DB review assertions. Application code and security policies untouched.

**ENGINEER:** revised isolated Chromium/PGlite target case 1/1 PASS; complete same source browser file **2/2 PASS**, including permanent-ID link retention/revoke path. No mocks. It does not prove hosted flake permanently eliminated.

**CYBERSECURITY:** relevant forged Worker denied with 303 /access-denied, stale Admin revoked cookie denied 303 login, restricted new share rejected 403, recipient link revoked; full manual ASVS/WSTG campaign and relevant adapter contracts still outstanding.

**REVIEWER:** AI source/raw-log check; original 218 IDs and previous historical counts immutable; changed-source checksum manifest updated from 16 to 17 tracked test paths, no new green credit. AI is not an outside independent agency. CI exact new commit and other release guards still pending.

**Private raw evidence:** `/home/ubuntu/work/.hse-qa-tmp/agency-zero-sequential-closure-001/ZERO001-PRIVACY-SSR-CI-FAILED-TARGETED-2PASS-ECR-20261125.json` with original hosted log hashes, original local pass and patched target/full-file logs. Patched full-file raw TAP SHA256: `8a1a61c885a816b514edf0d50713da63006b0eb77399c568b30458fe9edef50c`.

**NEXT:** guarded draft PR on top of #245 and exact-new-SHA hosted audit; no TECH FULL promotion. HSE testing and disposable services run on workstation, not Vercel.
