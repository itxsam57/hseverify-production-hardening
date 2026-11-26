# ZERO-001 — hosted CI privacy-sharing denial regression (workstation evidence)

**State:** isolated test-only fix **SCOPED PASS**, hosted exact changed-source full audit **NOT YET RECHECKED**. Approved application pin stays `7ff30ea140a5145e5d5ba761f7c7aef24c895269`. Original batch ZERO-001 is 0/4 TECH FULL; original Masterplan is 0/218. Vercel is unrelated; no production or shared stage writes.

**Observed RED:** Independent hosted full audit [run #45686950745](https://github.com/itxsam57/hseverify-production-hardening/actions/runs/45686950745) terminal failure, exact parent SHA `15887031b1ed350ebdcaf8ee40d0d8e1de75c2dd`. In `tests/browser/privacy-sharing-restriction.browser.test.mjs:85`, a forged Worker POST to Admin privacy produced HTTP 400 instead of the required HTTP 303 redirect to `/access-denied`. Final audit became 1 critical, 0 high; full regression exit 1. Same unmodified test at same SHA passed 1/1 locally: root cause is not proven, and the security denial is not waived.

**Bounded test-only change:** collect Admin SSR Server Action form fields from a *real authenticated browser* with JavaScript disabled, including the `$ACTION_ID_` marker, before forging Worker or stale-Admin POSTs. Missing marker fails the test rather than sending malformed 400-request body. Kept genuine status 303/redirect/403, Admin execution, public share revocation, revoked-session, and durable DB review assertions. Application code and security policies untouched.

**ENGINEER:** revised isolated Chromium/PGlite target case 1/1 PASS; complete same source browser file **2/2 PASS**, including permanent-ID link retention/revoke path. No mocks. It does not prove hosted flake permanently eliminated.

**CYBERSECURITY:** relevant forged Worker denied with 303 /access-denied, stale Admin revoked cookie denied 303 login, restricted new share rejected 403, recipient link revoked; full manual ASVS/WSTG campaign and relevant adapter contracts still outstanding.

**REVIEWER:** AI source/raw-log check; original 218 IDs and previous historical counts immutable; changed-source checksum manifest updated from 16 to 17 tracked test paths, no new green credit. AI is not an outside independent agency. CI exact new commit and other release guards still pending.

**Private raw evidence:** `/home/ubuntu/work/.hse-qa-tmp/agency-zero-sequential-closure-001/ZERO001-PRIVACY-SSR-CI-FAILED-TARGETED-2PASS-ECR-20261125.json` with original hosted log hashes, original local pass and patched target/full-file logs. Patched full-file raw TAP SHA256: `8a1a61c885a816b514edf0d50713da63006b0eb77399c568b30458fe9edef50c`.

**NEXT:** guarded draft PR on top of #245 and exact-new-SHA hosted audit; no TECH FULL promotion. HSE testing and disposable services run on workstation, not Vercel.


## 2026-11-26 exact PR246 hosted retest and bounded second diagnosis

Hosted full audit [#45701864467](https://github.com/itxsam57/hseverify-production-hardening/actions/runs/45701864467) **FAILED** at SHA `22733f37fb0e53311c3886c0dc25985238c14406`, full regression exit1, at unauthorized Worker Admin privacy POST HTTP400 vs expected HTTP303. Final verdict 1 automated critical, high0, medium14; this is NOT a proven exploitable critical. Raw full-regression SHA256 `b17a63afdd1c6af5aaa539d29b2eda47e3dc5ec3ddef35700abe815b287ddfde`. A separate exact-CI-style isolated workstation reproduction passed 1/1, so hosted root cause remains unconfirmed.

Second, bounded **test-only** diagnosis: Next.js Server Action code returns HTTP400 plus `x-nextjs-action-not-found:1` and `Invalid Server Action request.` when a POST references an unrecognized ID before authorization. A forged Worker test now fetches a fresh real authenticated Admin SSR form **once only** if that precise response appears, then still MUST receive HTTP303 `/access-denied` on fresh data. Any other HTTP400, repeated stale ID, wrong 303 destination or unauthorized mutation fails. Origin is supplied as it is for a legitimate browser form. Revoked-Admin stale session HTTP303, Admin completion and recipient revocation, and blocked new link HTTP403 remain unchanged.

Real workstation tests: default full Chromium/PGlite sharing file **2/2 PASS**, including permanent ID sharing link lifecycle, raw `ZERO001-privacy-SSR-auth-retry-CI-repro-20261126.log` SHA256 `4ae0e48d62651cf88c4d911f564ad2aabc5e64e90777b8ce9efa2f8cca8c3f56`; deliberate tampered Server Action ID caused actual first HTTP400 and subsequent refreshed authorization denial HTTP303 **1/1 PASS**, raw `ZERO001-privacy-stale-ID-forced-retry-20261126.log` SHA256 `b53b453566f7a52326bf1aca0c63aa18fe10a2a3a3cd8c97ef0ec1f8fce557fe`. Private evidence `ZERO001-privacy-SSR-stale-refreshed-denial-3realbrowser-ECR-20261126.json` hashed in workstation vault. New exact-hosted validation not yet done; do not award TECH FULL.

Separate original M1.01.04 release provenance **gap**: actual `scripts/create-release-manifest.mjs` in preview correctly records package-lock and migration checksums but accepts a fabricated all-zero 40-character `HSE_RELEASE_SHA` rather than independently binding to Git HEAD or a signed artifact. E/C/R raw receipt `ZERO001-M10104-release-manifest-source-parity-22733f3-20261126.json` SHA256 `93be377c0c3889fe8b8c05ec89c1542bad5b2989542d88f89bde63b68a641bfd`. This shows lack of independently verified source provenance, NOT proof of unauthorized production access.

Engineer, Cybersecurity, and Reviewer decisions remain **SCOPED**; hosted full audit, approved candidate source parity, source-attested release proof and comprehensive abuse matrix remain open. Original scenarios 0/218 TECH FULL.
