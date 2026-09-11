# M1.06 Subunit 4 Final Acceptance

## Final status

**DONE — ENGINEERING PASS — 10 August 2026**

## Scope

M1.06 Subunit 4 — Authorized Signed Preview/Download Pipeline.

This closure accepts the server-side signed preview/download capability only. It does not claim a Worker identity/evidence submission UI, reviewer-facing evidence workflow, Company verification workflow, public object storage, or production private-object provider activation.

## Exact accepted evidence

- Accepted base main before implementation: `d4acee0093c2d1cd540fc944c1937183dd3afa8a`
- Implementation PR: `#53`
- Exact validated implementation head: `b370142658238b47d842366f1af343f72533d0b1`
- Exact-head engineering gate: `31354949426 / 93352838153` — **PASS**
- Exact-head evidence artifact: `9050368203`
- Exact-head artifact digest: `sha256:83e54c82c85cd92b6591b91bad023e43bc0379a788b45d0f86a7db35d9e5c6a2`
- Implementation merge commit: `d03ce5322c2ffa0214c90ee5dc19c15e22da9d51`
- Merged-main engineering gate: `31355234897 / 93353573069` — **PASS**
- Merged-main evidence artifact: `9050454811`
- Merged-main artifact digest: `sha256:3e84fce13dd4ac981e0fc8faf3020046d92f90d65b2bad7f98415f6479c63469`
- Owner/browser test: **NOT REQUIRED — no browser-visible product surface was introduced**

## Accepted behavior

- only an exact live-owner scoped secure file in `available` state with complete accepted provenance can receive signed access;
- preview and download use distinct fixed purposes/endpoints and a short-lived HMAC capability;
- token authority is bound to exact live session/account/role and, for Company users, exact current tenant/membership scope without exposing raw scope identifiers;
- token tampering, malformed timestamps, expiry, wrong purpose, copied account/role/tenant/membership context and revoked/stale authority fail closed;
- issue-time and use-time repository lookups repeat the accepted session/owner/tenant authorization boundary;
- expected secure-file repository authorization denial is translated into the signed-access non-enumerating denial contract, while real operational/database errors are not hidden as access denial;
- authorization request JSON is streamed through a hard 4096-byte ceiling before buffering/parsing and rejects deceptive or malformed `Content-Length`, actual overflow, invalid UTF-8 and invalid JSON;
- private content is read only through the accepted private storage adapter and is revalidated against immutable byte size and SHA-256 immediately before serving;
- missing/tampered content fails non-enumerating, while trusted storage integrity/I/O failures remain operational server failures rather than fake 404 responses;
- response content type comes only from accepted stored provenance;
- `Content-Disposition` revalidates the stored display filename at the final response boundary, uses a server-generated ASCII fallback and encoded UTF-8 filename, and blocks path/control/header injection;
- responses enforce private/no-store caching, `nosniff`, no-referrer and same-origin resource policy;
- successful authorization and successful serving append immutable bounded audit facts without persisting signed token, URL, object key, content hash, secret or raw bytes;
- production/preview signed access fails closed until an approved real private-object provider exists; accepted development/test private storage remains the only active adapter in this subunit;
- route surface is exactly authorization, preview and download; no public object URL, browser-selected storage path/MIME/tenant/role/provider or later-brick product workflow was introduced;
- signed access remains safely reusable only while valid/live and is denied after session or Company membership authority becomes invalid;
- migration vocabulary rollback/reapply is monotonic and preserves immutable access history;
- runtime tests compile the complete relative dependency closure of trusted production entry modules rather than a brittle hand-maintained subset;
- historical Worker registration regression coverage was decoupled from volatile engineering-memory prose without weakening the actual Worker OTP/UI regression.

## Permanent regressions

`REG-055` through `REG-069` are permanent and documented in `docs/engineering/M1_06_SUBUNIT4_REGRESSIONS.md`.

These protect timestamp runtime typing, final filename/header validation, production `server-only` boundaries, semantic audit guards, build-context consistency, executable route/migration tests, semantic engineering state validation, API-only handoff classification, bounded request bodies, accurate no-browser handoff wording, repository denial translation, runtime dependency closure, real migration rollback contracts, storage operational error separation, and separation of product regressions from volatile governance prose.

## Milestone effect

M1.06 remains **IN PROGRESS** and Milestone 1 remains **5 of 12 bricks DONE**. This closure completes internal Subunit 4 only.

Subunit 5 — Complete M1.06 Isolation, Migration, Recovery and Acceptance — becomes the only next permitted M1.06 build unit. M1.07 and every later brick remain blocked until the complete M1.06 brick-level gate closes.
