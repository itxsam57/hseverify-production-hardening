# M1.08 Company Registration and Verification — Permanent Regressions

## REG-080 — Pending Company verification evidence must not widen generic Company secure-file authority

**Area:** M1.06 secure-file authority reused by M1.08 Company verification evidence.

**Root cause exposed during M1.08 design:** the accepted generic Company secure-file path correctly requires an `active` tenant, while a Company verification application must upload private evidence while its tenant is still `pending`. Loosening the generic M1.06 predicate would grant pending Companies ordinary tenant file authority and weaken an accepted security boundary.

**Root fix:** preserve the existing generic `active_tenant` authority unchanged and add a separate server-created `company_application` authority. The specialized brand is available only to an active Company account/session with its exact active owner/admin membership and exact tenant whose status is `pending` or `active`. The authority mode is held in trusted server state and exposed only as a frozen, non-enumerable property; browser input never selects it. Reservation, quarantine and scan repositories independently revalidate live session/account/membership/tenant state and choose the specialized pending guard only from that trusted brand.

**Permanent guards:**
- generic Company secure-file authority continues to require `tenant_status = 'active'`;
- specialized Company-application authority requires owner/admin membership and `tenant_status IN ('pending', 'active')`;
- pending Company ordinary secure-file read/reserve authority remains denied;
- specialized Company evidence can reserve/quarantine/scan only inside the exact authenticated account/tenant/membership scope;
- the trusted-owner enumerable object shape remains compatible with the accepted M1.06 contract;
- `scripts/check-company-verification.mjs` and the real PGlite M1.08 suite fail if these boundaries regress.

## REG-081 — Company registration OTP must use the shared encrypted authentication sandbox context

**Area:** Company self-registration email verification in development/test.

**Root cause exposed during M1.08 integration:** Company registration correctly stored its OTP as an encrypted sandbox delivery under a Company-specific destination hash context, but the shared sandbox reader originally derived only Worker-registration and password-recovery email contexts. The code therefore existed but the local/test Company verification inbox could not retrieve its own encrypted delivery.

**Root fix:** extend the existing shared authentication sandbox reader with the Company registration email destination context. No plaintext OTP response, Company-only bypass, production fallback or second sandbox store was introduced. Preview/production continue to fail closed unless approved live email delivery exists.

**Permanent guards:**
- Company registration email delivery remains stored encrypted in the accepted authentication sandbox table;
- the shared reader derives `company-registration-email-destination` only in local/test sandbox mode and still requires the sandbox access key;
- no registration action returns the OTP in normal application payloads;
- `scripts/check-company-verification.mjs` requires the shared Company destination context.

Both regressions are release-blocking for M1.08 and remain permanent after the brick closes.
