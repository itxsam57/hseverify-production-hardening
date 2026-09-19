# Security Penetration and Hardening Report — 2026-09-19

## Verdict

The authorized local/preview security assessment is complete. All confirmed defects found in this pass are fixed and verified. No open Critical, High, Medium, or Low findings remain in the final database or live-browser audits.

This is an evidence-backed application assessment, not a guarantee that no unknown vulnerability exists. Production activation still depends on the approved external provider integrations and their own security review.

## Confirmed defects fixed

| Severity | Defect | Root cause | Fix | Verification |
|---|---|---|---|---|
| High | Privacy operations accepted a blank tenant boundary | Optional tenant scope distinguished `null` from a tenant but did not reject an empty/whitespace identifier | Reject blank non-null tenant IDs at every privacy/accommodation transition boundary | Privacy security/runtime tests 15/15 |
| High | Staff enrollment could reach password hashing before persistent throttling | The rate-limit service existed but the profile-completion action did not call it | Enforce the token-scoped persistent limit before `completeProfile` and password hashing | Authentication compute-limit regression passes |
| Medium | Scoped-share access ledger had no row identity | Access events were append-only but the table had no primary key | Migration 0065 adds an independent `bigserial` primary key with reversible rollback | Independent database audit 8/8, zero findings |
| Medium | Company invitations page overflowed horizontally | Native date/time input retained an intrinsic minimum width wider than its responsive grid cell | Shared design-system controls now permit grid shrinkage with `min-width: 0` | Live DOM measurement 1440/1440; final browser audit zero findings |
| High | Admin certification controls lacked accessible labels | Placeholder-only fields had no label relationship | Added explicit wrapping labels | Final browser audit zero findings |
| Test integrity | Repeated TOTP logins produced a false role-isolation failure | The independent audit reused the same TOTP counter | Audit waits for a fresh counter before a repeated role login | All six role-isolation sweeps pass |
| Test integrity | Database rollback audit called an unsupported PGlite method | Migration runner expects the application database adapter contract | Added an explicit PGlite-to-migration adapter in the independent audit | Rollback/reapply checkpoint passes |
| Test integrity | Written-scoring isolation mock expected an obsolete projection | Runtime query added `tenant_id`; the mock matcher was stale | Updated the security mock to match the real tenant-scoped query | Security isolation regression passes |

## Security coverage and results

- Dependency audit: 0 known production vulnerabilities.
- Dependency floors: Next.js, nanoid, PostCSS, and Sharp all meet the recorded secure minimums.
- Independent database audit: 8/8 checkpoints pass; 0 findings.
- Adversarial security suite: 43/43 pass.
- Secure-file access runtime: 5/5 pass.
- Secure-file malware/tenant isolation runtime: 3/3 pass.
- Public verification abuse, privacy, projection, and rate-limit suite: 28/28 pass.
- Full engineering/release gate: pass, including deterministic production build and deployable preview smoke.
- Final live Chromium audit:
  - 79 discovered page routes (70 static, 9 dynamic).
  - Fresh Worker and Company registration/verification/login workflows pass.
  - Complete authenticated route sweeps pass for Worker, Company, Assessor, Verifier, Admin, and Root.
  - Every cross-role dashboard probe is denied for all six roles.
  - Unknown public identifiers fail without enumeration detail.
  - 0 Critical, High, Medium, Low, or Informational findings.

## Security controls directly verified

- Fixed-role and tenant isolation, including copied identifiers and lifecycle races.
- Session revocation and portal isolation.
- OTP replay prevention and pre-hash abuse limits.
- Opaque public capabilities and non-enumerating failure behavior.
- Signed secure-file authorization, purpose separation, bounded JSON parsing, expiry, live membership checks, and immutable audit records.
- Upload quarantine, malware scan semantics, object tamper failure, lease recovery, and cross-company isolation.
- Append-only assessment answers, audit/history records, immutable versioning, and rollback/reapply safety.
- Security headers: CSP, HSTS, frame denial, MIME sniffing denial, referrer policy, and permissions policy.
- Billing webhook fail-closed behavior when no secret is configured.

## Remaining owner/provider blockers

These are production-integration blockers, not unresolved defects found by this assessment:

- Approved live email and SMS delivery providers.
- Approved private object storage and malware-scanning providers.
- Approved liveness and video-interview providers.
- Approved payment provider and production webhook secret.
- Hosted production/preview infrastructure and provider-specific penetration testing.

## Evidence

Machine-readable and Markdown audit outputs are generated under `artifacts/independent-audit/`. The permanent security regressions and the complete engineering gate are part of the repository test suite.
