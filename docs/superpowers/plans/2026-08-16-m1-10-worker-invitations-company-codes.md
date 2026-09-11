# M1.10 Worker Invitations and Company Codes — Engineering Factory Work Contract

Date: 2026-08-16
Branch: `build/m1-10-worker-invitations-company-codes`
PR: #76
Risk depth: **CRITICAL**
Frozen parent boundary: M1.09 merged-main `1fe96b412db3cfa4e370a2d60cd13ce00aa3e3bf`

## Mission Lock

Finish only M1.10 Worker Invitations and Company Codes. Preserve the accepted M1.03 Worker registration/contact-verification authority, M1.07 Worker identity/permanent Worker-ID authority, M1.08 Company verification authority, and M1.09 Company organization/team tenant controls. Do not start M1.11 employment/competency history, M1.12 dashboard/action-centre behavior, or M2 assessment/order execution.

## Frozen requirements

- **M110-R01 Single Worker invitation.** A Company user with live server-derived `company.workforce.manage` may invite one Worker by normalized email.
- **M110-R02 Bulk Worker invitation.** CSV/bulk input produces deterministic per-row success/error output; malformed or duplicate rows do not silently disappear.
- **M110-R03 Company registration codes.** A verified Company may create codes with bounded expiry and usage limits; codes are revocable before exhaustion/expiry.
- **M110-R04 Unit defaults.** Invitation/code defaults may reference only active Site/Department rows from the actor's current tenant.
- **M110-R05 Payment default.** Invitation/code may carry a bounded payment-responsibility default (`company` or `worker`) for later order creation; M1.10 must not execute billing/order logic.
- **M110-R06 Future assessment reference.** Optional opaque assessment-reference metadata is bounded and stored only; no assessment assignment/execution logic is introduced.
- **M110-R07 Existing Worker linking.** An existing Worker may consent to link to the verified Company by invitation/code/permanent Worker-ID flow without Company ownership of the Worker identity record.
- **M110-R08 New Worker linking.** New Worker enrollment reuses the accepted Worker registration and mandatory email/phone verification flow; M1.10 must not create a second account/OTP/password system.
- **M110-R09 Secret lifecycle.** Raw invitation/code secrets are generated cryptographically, hashed with the platform pepper and context before persistence, never recoverable from storage, and exposed only at the bounded creation/delivery edge.
- **M110-R10 Resend/revoke/idempotency.** Invitations have resend throttling; unused invitations/codes may be revoked; repeated acceptance/redemption/link requests are idempotent or return a neutral conflict without duplicate links/usage.
- **M110-R11 Authorization and isolation.** Mutation authority is re-derived from the live tenant membership inside the transaction. Cross-tenant selectors and invalid/expired/revoked secrets produce non-enumerating failures.
- **M110-R12 Verified Company gate.** High-risk workforce mutation requires the current Company to remain verified according to the accepted M1.08 authority.
- **M110-R13 Worker identity gate.** Permanent Worker-ID linking uses the accepted permanent Worker-ID record and active Worker account; no Worker identity record is copied or transferred.
- **M110-R14 Immutable audit.** Invitation/code creation, resend, revoke, redemption and Worker link activation are transactionally audited with trusted actor binding and immutable history.
- **M110-R15 UI route.** `/company/invitations` provides Company-facing single/bulk invitations and code management using server actions. Existing M1.09 staff/team invitations remain in `/company/team` and are not duplicated.
- **M110-R16 Permanent evidence.** M1.10 adds source guards plus runtime, migration/restart, authorization, secret-lifecycle and concurrency regression tests and wires them into aggregate engineering gates.
- **M110-R17 No scope leakage.** No M1.11 employment/competency history, M1.12 action-centre/dashboard expansion, M2 assessment execution or payment-provider integration.

## Architectural socket

1. Extend the database monotonically after migration 0027 with a Company workforce invitation/code/link foundation and, only if required by evidence, a follow-up hardening migration.
2. Reuse `auth_accounts` + Worker role as account authority, `worker_identities`/permanent Worker-ID tables as Worker identity authority, `platform_tenants` + `auth_tenant_memberships` as tenant authority, `company_sites`/`company_departments` as unit authority, and M1.08 Company verification status as workforce-mutation eligibility.
3. Add a focused Company workforce domain/service/repository surface. Browser input may supply resource identifiers and form values but never tenant ID, actor account ID, membership ID, permission booleans, verification status, or trusted audit actor.
4. Use `runTenantScopedCommand`, live membership locking, role/permission re-derivation, same-tenant unit checks, shared `createOpaqueToken`/`hashOpaqueValue`, trusted audit binding, and the existing database transaction abstraction.
5. Link records represent Company↔Worker association only. They must not become an employment-history model before M1.11.

## Completion evidence

Engineering acceptance requires all of the following on the exact PR head SHA:

- RED proof from M1.10 permanent tests before production implementation.
- GREEN M1.10 source/runtime/migration/security/concurrency suites.
- Existing quick/full engineering gates remain green.
- Migration apply/restart/rollback/reapply evidence preserves M1.09 and M1.10 durable history contracts.
- Code/architecture review finds no parallel auth/identity/tenant authority and no M1.11/M2 leakage.
- Security review confirms tenant isolation, live authorization, verified-Company gate, hashed secrets, non-enumerating failures, rate limits and atomic usage/linking.
- Test-quality review confirms negative tests can fail for wrong behavior and do not merely grep superficial markers.
- Regression/stale-code review confirms no duplicate staff-invite path, no obsolete authority path and no unreachable M1.10 code.
- Gatekeeper records the exact accepted SHA and only then may PR #76 be made ready/merged.
- Merged `main` must pass the engineering gate on the merge SHA.

Owner/browser acceptance for M1.08–M1.12 remains intentionally deferred to the combined Milestone 1 owner test already frozen in PR #76. Therefore an engineering-accepted/merged M1.10 is not to be mislabeled owner-accepted or Release Ready.

## Test-first execution plan

### Task 1 — Freeze tests and source guard (RED)

Create `scripts/check-company-worker-invitations.mjs`, `scripts/run-company-worker-invitation-tests.mjs`, `tests/platform/company-worker-invitations.test.mjs`, and `tests/platform/company-worker-invitations-migration-stack.test.mjs`. Wire `check:m1-10` and `test:m1-10` into `package.json` aggregate gates. Tests must assert live authorization, verified-company gating, same-tenant active units, secret hashing, expiry/revoke/resend limits, bulk row errors, atomic code usage, idempotent acceptance/linking, permanent Worker-ID authority, audit events and restart/migration behavior. Commit tests before production code and record the expected failing CI evidence.

### Task 2 — Persistence foundation (GREEN slice 1)

Add the next up/down migration(s) with tenant-scoped invitation, code and Worker-link tables; strict checks/FKs; unique active-link protection; usage counters; immutable historical fields; database-level guards for tenant/unit/Worker authority where practical; audit action/target enum additions. Rollback must preserve previously accepted lower-layer behavior.

### Task 3 — Domain/repository/service (GREEN slice 2)

Add focused Company workforce types and commands. Implement single invite, bulk invite validation, resend, revoke, code create/revoke, invitation/code acceptance/linking and existing-permanent-Worker-ID link request/acceptance as required by the frozen contract. All mutations execute in one tenant-scoped transaction with live authority re-derived inside it.

### Task 4 — Worker registration integration (GREEN slice 3)

Add only the smallest hook necessary for optional Company invitation/code context to survive the existing Worker registration flow and bind only after mandatory contact verification succeeds. Do not duplicate Worker registration, OTP, password or account creation logic.

### Task 5 — Company route/UI (GREEN slice 4)

Add `/company/invitations` page/actions and a bounded workspace for single invite, bulk CSV, code creation/revocation and current invitation/code/link status. No browser-provided authority selectors. Destructive revoke actions require explicit confirmation. Secret/token UX must prefer invitation links and one-time code display; it must not ask users to paste opaque invitation tokens copied from storage.

### Task 6 — Full verification and root-cause loop

Run exact-head CI. For any failure, inspect logs, identify one root cause, add/strengthen a reproducing regression test first, then make the smallest architectural fix. Maximum three root-cause revision cycles before escalation/re-scope.

### Task 7 — Reviewer passes

Perform fresh code/architecture, security, evidence-test and regression/stale-code reviews against the immutable candidate SHA. Any finding returns to Task 6; the builder pass may not self-accept merely because CI is green.

### Task 8 — Gatekeeper, merge, post-merge proof

Confirm exact-head green checks and review acceptance, mark PR #76 ready, merge only that accepted SHA, then verify merged-main engineering checks on the resulting `main` SHA. Update the project status/evidence ledger truthfully; do not start M1.11 in this work contract.
