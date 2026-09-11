# M1.09 Permanent Regression Addendum

These regressions are permanent release gates for **M1.09 — Sites, Departments and Company Team**. They supplement the global regression register and remain active after later bricks advance.

## REG-086 — Historical acceptance checker must not own the future roadmap state

**Failure class:** accepted M1.06/M1.07/M1.08 checkers encoded statements such as “M1.07 must still be IN PROGRESS” or “M1.09 must still be BLOCKED,” causing valid later-brick code to fail despite the accepted historical product behavior remaining unchanged.

**Permanent control:** historical milestone/subunit checkers verify their own immutable implementation/evidence contracts only. The live brick position belongs to `check:engineering` and `docs/NEXT_BUILD_UNIT.md`. Removing stale future-state coupling must never remove the accepted product/security assertions owned by that historical checker.

## REG-087 — Organization/Team state and audit fact must commit atomically

**Failure class:** a Site, Department, invitation or Team membership mutation could commit while its material audit fact was omitted or failed afterward.

**Permanent control:** M1.09 repositories/services append bounded native audit facts through `DatabaseAuditRepository(Promise.resolve(database))` inside the same tenant-scoped transaction as the owning state change. The additive 0027 audit vocabulary is part of the database constraint and typed audit domain.

## REG-088 — Archival/deactivation must end assignments without deleting or resurrecting history

**Failure class:** archiving a Site/Department or suspending/revoking a Team membership could leave active assignments behind, delete evidence of old assignments, or restore old assignments automatically when the unit/member returned to active state.

**Permanent control:** database triggers end active assignment rows with timestamp/reason. Ended rows remain durable. Archived units and inactive memberships cannot receive active assignments. Restore/reactivation never creates an assignment; a new assignment requires an explicit authorized action.

## REG-089 — Company Team authority must be live, bounded and lockout-safe

**Failure class:** stale principal/UI permissions could grant authority already removed in the database; an admin could promote another admin/owner; a user could change their own role/status; or the final active owner could be removed.

**Permanent control:** every Team mutation re-reads the actor membership and effective permissions under the current transaction. Selected permissions must be within both the target role ceiling and actor’s live authority. Role grants follow `canGrantTenantRole`. Self management is rejected. Service logic and the 0027 database trigger independently protect final active owner continuity.

## REG-090 — Company Team membership must activate only through accepted Company + TOTP enrollment

**Failure class:** a pending Company staff invitation could become an active tenant membership before the invited account completed the accepted staff password/TOTP path.

**Permanent control:** M1.09 reuses `auth_staff_invitations` and `/staff/invite/<token>` rather than creating parallel authentication. The 0026 acceptance trigger requires exact Company invitation binding, active Company account/role, matching email, active tenant and active TOTP factor before it inserts the tenant membership and initial permission/unit state. A failed acceptance creates no membership.

## REG-091 — Destructive Company organization/team actions require explicit confirmation

**Failure class:** a single accidental click could archive a Site/Department, suspend/revoke Team access or cancel an invitation, causing meaningful operational state changes without a clear warning.

**Permanent control:** destructive M1.09 browser actions use the shared portal-safe `ConfirmDialog`. The confirmation describes the impact, submits only opaque record/stale-state fields, and never accepts tenant/actor/permission authority from the browser. React Server Action transport metadata remains React-owned; no explicit `encType`/`method` override is introduced.
