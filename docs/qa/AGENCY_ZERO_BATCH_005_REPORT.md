# ZERO-005 — Authorization and tenant isolation

**Four original related workflows: scoped real Chromium browser cases 4/4 PASS; technical FULLY VERIFIED 0/4.**

Frozen application source: `7ff30ea140a5145e5d5ba761f7c7aef24c895269`. QA tooling at test start: `24ec42dc46b7fffd06a4a6bcaf727be16e98f9ac`. All tests used disposable local/synthetic stores, no shared staging or production modifications.

| Original scenario | Real action / adversarial UI+API boundary tested | Result |
|---|---|---|
| `M1.04.01` | M1.04.01 real Admin Server Action POST rejects five foreign role sessions and unauthenticated replay | PASS (1/1, no skips) |
| `M1.04.02` | M1.04.02 two real Company browser sessions isolate secure PDF issue, preview, download, copied tokens and tenant headers | PASS (1/1, no skips) |
| `M1.04.03` | M1.04.03 two real Worker sessions isolate secure file IDs, signed tokens, forged account hints and revoked access | PASS (1/1, no skips) |
| `M1.04.04` | Company owner completes organization, workforce, Team, assurance, policy, report and tenant-scope workflows in Chromium | PASS (1/1, no skips) |

## Engineer / Cybersecurity / Reviewer

- **ENGINEER — SCOPED PASS:** Actual Chromium/Next.js tests exercised authorized and denied Server Action calls, tenant-specific secure PDF issue/preview/download, worker-specific file capability/ownership, and owner-to-company-team permission / membership lifecycle. All four browser cases passed; source code spot-check found account/role/tenant-bound queries and server-side session revocation. No full code-quality or every-UI-control audit is yet evidenced.
- **CYBERSECURITY — SCOPED PASS / NOT FULL PENTEST:** Denied five foreign roles plus anonymous privileged Server Action replay; Company A/B cross-tenant secure file references, copied signed URLs, forged headers, range/HEAD and no-store checks; Worker A/B IDOR/copied capability attempts; company Team scope, suspension/revocation and stale-session denial in connected browser journey. These cases did not exhaust every API, race, role, upload/provider adapter or attack class. Overall unresolved high/critical vulnerabilities remain UNKNOWN.
- **REVIEWER — INCOMPLETE:** Exact 4 source case identities, one-pass/no-skips per log, tested original scenario mapping and safety isolation checked. No genuinely independent separate reviewer has signed all UI, code, workflow and cross-role coverage. Do not count as owner-testing-ready yet.

## Remaining evidence / non-stalling follow-up

- M1.04.01: full cross-role endpoint inventory (not only Admin Server Action) and unauthorized action event/secret leak review.
- M1.04.02: complete tenant-scoped resource/filter/export matrix outside tested secure PDFs; full adapter storage/scanning contract tested separately.
- M1.04.03: all cross-worker record IDs, internal APIs and copied credentials beyond secure file and selected resource behavior.
- M1.04.04: independently verify every stale permission/membership type, concurrency and report downstream under post-revocation conditions.

## Private source logs and SHA256 evidence

- `M1.04.01`: `private-workstation:artifacts/agency-zero/ZERO-005/M1.04.01.log` SHA256 `ed3319c5cf1c33091ccd53d90d4008fc675f3fd149c5b465b56f26e1ab78300c`
- `M1.04.02`: `private-workstation:artifacts/agency-zero/ZERO-005/M1.04.02.log` SHA256 `3f6e75a1db616244a7b99a681d9fb73f3bc66e36073a7fd79d084e1a003e8aef`
- `M1.04.03`: `private-workstation:artifacts/agency-zero/ZERO-005/M1.04.03.log` SHA256 `347fb5894c9beb6776fa8cf7b2f9bcfe168c4443a4e3166488e355b61e8449a2`
- `M1.04.04`: `private-workstation:artifacts/agency-zero/ZERO-005/M1.04.04.log` SHA256 `cdee9318cf970e15ab4ce3d24feb302e44e66220ba8e5c8b602ac97d78631a0b`

## Exact continuation

Record scoped passes without technical certification; advance to **ZERO-006**, keep ZERO-001..005 in the evidence-gap/revisit queue. No product source change, merge or deploy occurred.

Recorded UTC: 2026-11-22T17:52:08.420088+00:00
