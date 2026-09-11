# M1.12 Public Verification Foundation — Design

**Date:** 17 August 2026  
**Status:** Approved active-brick design derived from the frozen Phase 1 specification  
**Branch:** `build/m1-12-public-verification-foundation`  
**Verified base:** `ff296f7d59a6505241796f654249c3df6b97763d`  
**Governance baseline:** `20096a51fb343224760aee7bd163570b56df1022`, full Engineering gate `32014646683` PASS

## 1. Source authority

The frozen Phase 1 specification defines M1.12 as **Public verification foundation — Worker ID search, safe projection, report concern and QR route base**.

Public verification must:
- accept a Worker ID or Credential ID, or a signed QR route;
- apply rate limits and abuse controls;
- expose only an approved public-field projection;
- keep not-found responses neutral;
- show expired/suspended/revoked status without internal reasons unless policy permits;
- create a concern triage case with category, description, contact and optional evidence;
- exclude passport/national ID numbers, full DOB, home address, contact details, assessment answers, integrity methods/thresholds, reviewer notes, private employment/company data and unpublished scores.

M1.12 does not create credential issuance. Credential IDs are accepted as a public identifier class only when a real accepted credential source exists; until M3.01, credential-shaped identifiers resolve through the same neutral safe-miss path.

## 2. Architecture choice

M1.12 adds one dedicated `public-verification` module. It does not call authenticated Worker/Company repositories by bypassing their guards and does not serialize internal records then redact them.

The module has four boundaries:

1. **Identifier + projection domain** — bounded parsing, fixed result-state vocabulary, explicit public-field allow-list.
2. **Public verification repository/service** — durable server-owned abuse buckets, Worker-ID lookup from M1.07 authority, safe public projection, and concern triage persistence.
3. **Opaque public capability** — an authenticated-encrypted, purpose-separated, expiry-bounded token containing only the minimum lookup authority. The browser never receives raw account, identity-version, tenant, evidence, secure-file or storage identifiers as route authority.
4. **Public presentation** — `/verify`, `/verify/result/[token]`, and `/verify/qr/[token]`, with manual input always available and camera access only after explicit activation.

Application servers remain stateless. Result capabilities are cryptographic rather than session rows. Durable state is used only where state is necessary: abuse counters, concern cases and optional concern evidence bindings.

## 3. Public identifier model

### Worker ID

The accepted M1.07 authority is `worker_identity_worker_ids.permanent_worker_id`, shape:

`worker_id_[A-Za-z0-9_-]{24}`

M1.12 never reissues, aliases or mutates it.

### Credential ID

M1.12 recognizes a conservative credential/public-verification identifier class only for neutral routing. Because credential issuance is M3.01, no successful credential lookup is fabricated in M1.12.

### Malformed and unknown values

Malformed, unsupported, unknown, copied or currently non-public identifiers converge on the same public state:

`not_found_or_invalid`

No response reveals whether private Worker/evidence/history exists.

## 4. Public result vocabulary

Fixed external states:

- `valid`
- `expired`
- `suspended`
- `revoked`
- `not_found_or_invalid`
- `temporarily_unavailable`

M1.07 verified/reinstated identity with a permanent Worker ID maps to `valid`.
M1.07 expired-document state maps to `expired`.
M1.07 suspended state maps to `suspended`.
Closed/withdrawn/rejected/more-info/manual-review/draft/internal states do not disclose internal lifecycle details and converge on `not_found_or_invalid` unless a later accepted public credential policy owns a different mapping.
M1.12 does not invent a revocation transition for Worker identity; `revoked` is reserved for later real credential/public records.

## 5. Public-safe projection

For an M1.12 Worker-ID result the allow-list is intentionally small:

```ts
type PublicWorkerVerificationProjection = {
  kind: "worker";
  publicIdentifier: string;
  displayName: string;
  status: PublicVerificationStatus;
  issuedAt: string | null;
  expiresAt: string | null;
  competencyTitle: string | null;
  restrictions: readonly string[];
  verifiedAt: string;
};
```

M1.12 may expose `displayName` only from the accepted current identity version's legal first/last name because the frozen public-verification workflow requires an approved public identity summary. It exposes no DOB, nationality, residence, email, phone, previous legal name, document/evidence identifiers or employer data.

`competencyTitle`, `expiresAt` and `restrictions` remain null/empty for Worker-ID verification until a real accepted credential/competency source exists. M1.12 must not infer competency from private qualification/employment records.

`verifiedAt` is the verification-request timestamp. `issuedAt` is the immutable M1.07 Worker-ID issuance timestamp.

## 6. Opaque result capability

Public result URLs use `/verify/result/[publicToken]`.

The token is authenticated encryption, not readable JSON/base64. It contains only:

```ts
{
  v: 1;
  purpose: "public-verification-result";
  identifierKind: "worker" | "credential";
  normalizedIdentifier: string;
  issuedAt: string;
  expiresAt: string;
}
```

Rules:
- server-created random nonce;
- AES-256-GCM key derived from the configured server secret with a dedicated M1.12 context string;
- maximum lifetime 10 minutes;
- purpose and version checked on decrypt;
- malformed/tampered/expired token fails closed to `not_found_or_invalid` without stack/internal detail;
- result page re-queries live public state at render time, so a later suspension/expiry is reflected rather than trusting stale token content.

`/verify/qr/[token]` accepts only the same purpose-separated encrypted authority and resolves through the exact same service. It creates no second lookup implementation.

## 7. Abuse controls

M1.12 owns `public_verification_rate_limits`, rather than widening authentication-only rate-limit vocabulary.

Server bucket keys are HMAC/SHA-derived and never browser-selected directly. At minimum:
- request-fingerprint bucket (IP + bounded user-agent metadata, hashed with server secret);
- normalized-identifier bucket after bounded normalization;
- action separation for `lookup`, `result`, `concern` and `concern_upload`.

The repository uses atomic `INSERT ... ON CONFLICT ... DO UPDATE` counters. Window reset and increment happen in SQL so concurrent requests cannot exceed the logical counter without being counted.

Rate-limit response is `temporarily_unavailable`; it never reveals whether the identifier exists.

## 8. Public lookup sequence

1. Read bounded request metadata server-side.
2. Consume request-fingerprint rate bucket before identifier lookup.
3. Normalize one public identifier.
4. Consume hashed identifier bucket.
5. For a supported Worker ID, query the permanent M1.07 Worker-ID authority joined only to the exact fields required by the public allow-list.
6. Convert internal state through the fixed public mapping.
7. On public-safe success, mint a short-lived opaque result capability.
8. On malformed/unknown/non-public input, return the same neutral miss state.
9. Redirect success to `/verify/result/[token]`; render safe miss/unavailable on `/verify` without embedding private identifiers in query parameters.

Lookup itself creates no durable business object and therefore remains idempotent.

## 9. Concern triage

The frozen public-verification workflow requires `Report a Concern` to create a triage case. M1.12 therefore owns a minimal immutable-input concern intake record; later M2 Review Engine owns review decisions/queues.

Concern fields:
- opaque `concern_id`;
- hash/reference to the public verification subject, not raw account/identity/storage IDs;
- fixed category vocabulary;
- bounded description;
- bounded contact name/email/phone fields supplied by the reporter;
- intake status limited to `received` in M1.12;
- created timestamp;
- idempotency key derived from an opaque browser nonce + server context so duplicate submit retries do not create multiple cases.

The public URL may carry only the opaque result capability. Server code resolves and hashes the subject reference before persistence.

Material concern creation appends a centralized M1.05 audit event using a dedicated system/public-intake actor representation approved by the audit domain; it must not invent a second audit store.

### Optional evidence

Optional PDF/PNG/JPG/JPEG concern evidence must reuse the M1.06 quarantine/scan/private-storage pipeline. M1.12 may extend secure-file authority only through a narrowly branded `public_concern` intake capability bound to one already-created concern. It must not weaken Worker/Company owner checks or expose signed public file access.

Evidence becomes bound to the concern only after the M1.06 file reaches `available`. Unsafe/failed/pending files never become accepted concern evidence. Retry after terminal scan failure must not lock the concern slot.

No public preview/download endpoint is created for concern evidence.

## 10. QR/manual UX

`/verify` contains:
- one manual identifier field;
- Verify action with loading/duplicate-submit protection;
- `Scan QR` control;
- clear neutral miss and temporary-unavailable states;
- concise privacy note describing public-only projection.

Camera behavior:
- page render never calls `getUserMedia`;
- `Scan QR` is the only activation path;
- if native `BarcodeDetector` + camera are available, scan QR values locally and submit the decoded HSE Verify route/identifier;
- permission denied, unsupported browser or scan failure leaves manual lookup available and shows a non-blocking safe message;
- no camera frame is uploaded or stored by M1.12.

No third-party QR/scanner dependency is added unless native browser support proves insufficient during the combined owner/browser acceptance. The route foundation itself is provider-independent.

## 11. Data migration

M1.12 uses additive migration `0031_public_verification_foundation` after M1.11 `0030_worker_evidence_records`.

Owned tables:
- `public_verification_rate_limits`;
- `public_verification_concerns`;
- `public_verification_concern_evidence_candidates` if needed for async scan finalization.

Any secure-file/audit vocabulary extension is additive and preserves accepted lower-brick data and rollback behavior. M1.12 tests must prove restart, logical rollback/reapply, and that its history never blocks lower-brick rollback tests.

## 12. Security regressions that block release

- public projection contains any excluded/private field;
- raw internal ID appears in result/concern URL authority;
- unknown/malformed input differs in a way that enumerates private existence;
- rate-limit counter loses increments under concurrency;
- copied/tampered/expired result token resolves;
- QR route bypasses lookup/rate-limit/projection rules;
- camera permission requested on page render;
- concern duplicate submit creates duplicate cases;
- concern evidence bypasses quarantine/scan or becomes publicly downloadable;
- any Worker/Company/role/tenant isolation regression;
- route change requires manual refresh;
- any later M2/M3 credential issuance/review decision/living-record authority appears in M1.12.

## 13. Release boundary

M1.12 engineering release requires permanent targeted `check:m1-12` + `test:m1-12`, full exact-head Engineering PASS, review, expected-head merge lock and merged-main full Engineering PASS.

Owner/browser acceptance remains intentionally combined with deferred M1.08–M1.11 visible acceptance after M1.12 engineering release. CI does not imply owner PASS.