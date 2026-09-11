import "server-only";

import {
  createIdentifier,
  createOpaqueToken,
  hashOpaqueValue,
  normalizeEmail
} from "../auth/auth-domain";
import { AuthAccessRepository } from "../auth/auth-access-repository";
import {
  canGrantTenantRole,
  tenantPermissionsForRole,
  type TenantMembershipRole,
  type TenantMembershipStatus,
  type TenantPermission
} from "../authorization/authorization-domain";
import { runTenantScopedCommand } from "../authorization/tenant-scoped-command-guard";
import type {
  TenantPermissionPrincipal,
  TrustedTenantScope
} from "../authorization/tenant-scoped-resource-domain";
import { bindTrustedAuditActor } from "../audit/audit-domain";
import { DatabaseAuditRepository } from "../audit/audit-repository";
import { getServerEnvironment } from "../config/server-environment";
import { getDatabaseClient, type DatabaseClient } from "../database/database";

const MANAGE_PERMISSION = "company.members.manage" as const;
const READ_PERMISSION = "company.members.read" as const;
const INVITATION_TTL_MS = 48 * 60 * 60 * 1000;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const MAX_INVITATIONS = 20;

export type CompanyTeamInvitationResult = Readonly<{
  invitationId: string;
  email: string;
  membershipRole: TenantMembershipRole;
  expiresAt: string;
  invitationPath: string;
}>;

export type CompanyTeamInvitationRecord = Readonly<{
  invitationId: string;
  email: string;
  membershipRole: TenantMembershipRole;
  status: "pending" | "accepted" | "revoked" | "expired";
  permissions: readonly TenantPermission[];
  siteId: string | null;
  siteName: string | null;
  departmentId: string | null;
  departmentName: string | null;
  expiresAt: string;
  createdAt: string;
}>;

export type CompanyTeamMemberRecord = Readonly<{
  membershipId: string;
  accountId: string;
  displayName: string;
  email: string;
  membershipRole: TenantMembershipRole;
  status: TenantMembershipStatus;
  permissions: readonly TenantPermission[];
  siteId: string | null;
  siteName: string | null;
  departmentId: string | null;
  departmentName: string | null;
  activatedAt: string | null;
}>;

export class CompanyTeamInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CompanyTeamInputError";
  }
}
export class CompanyTeamAccessError extends Error {
  constructor() {
    super("The Company Team operation could not be completed.");
    this.name = "CompanyTeamAccessError";
  }
}
export class CompanyTeamConflictError extends Error {
  constructor(message = "The Company Team operation conflicts with current state.") {
    super(message);
    this.name = "CompanyTeamConflictError";
  }
}

function addMs(date: Date, milliseconds: number): string {
  return new Date(date.getTime() + milliseconds).toISOString();
}
function timestamp(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
function uniquePermissions(values: readonly string[]): readonly TenantPermission[] {
  const allowed = new Set<TenantPermission>();
  for (const value of values) {
    if (!tenantPermissionsForRole("owner").includes(value as TenantPermission)) {
      throw new CompanyTeamInputError("Unknown Company permission.");
    }
    allowed.add(value as TenantPermission);
  }
  return Object.freeze([...allowed]);
}
function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as { code?: unknown }).code === "23505");
}

const MEMBER_COLUMNS = `
  m.membership_id,
  m.account_id,
  a.display_name,
  a.email_normalized,
  m.membership_role,
  m.membership_status,
  m.activated_at,
  x.site_id,
  s.name AS site_name,
  x.department_id,
  d.name AS department_name
`;

type MemberRow = {
  membership_id: string;
  account_id: string;
  display_name: string;
  email_normalized: string;
  membership_role: TenantMembershipRole;
  membership_status: TenantMembershipStatus;
  activated_at: string | Date | null;
  site_id: string | null;
  site_name: string | null;
  department_id: string | null;
  department_name: string | null;
};
type OverrideRow = { permission_key: TenantPermission; effect: "grant" | "deny" };
type LiveActorRow = {
  membership_role: TenantMembershipRole;
  membership_status: TenantMembershipStatus;
};
type TargetMembershipRow = {
  membership_id: string;
  account_id: string;
  membership_role: TenantMembershipRole;
  membership_status: TenantMembershipStatus;
};
type ActiveAssignmentRow = {
  assignment_id: string;
  site_id: string | null;
  department_id: string | null;
};
type InvitationRow = {
  invitation_id: string;
  email_normalized: string;
  membership_role: TenantMembershipRole;
  invitation_status: "pending" | "accepted" | "revoked" | "expired";
  expires_at: string | Date;
  created_at: string | Date;
  site_id: string | null;
  site_name: string | null;
  department_id: string | null;
  department_name: string | null;
};

async function liveActor(
  database: DatabaseClient,
  scope: TrustedTenantScope
): Promise<LiveActorRow> {
  const result = await database.query<LiveActorRow>(
    `SELECT membership_role, membership_status
     FROM auth_tenant_memberships
     WHERE tenant_id=$1
       AND membership_id=$2
       AND account_id=$3
       AND portal_role='company'
     FOR UPDATE`,
    [scope.tenantId, scope.membershipId, scope.accountId]
  );
  const row = result.rows[0];
  if (!row || row.membership_status !== "active") throw new CompanyTeamAccessError();
  return row;
}

async function livePermissions(
  database: DatabaseClient,
  membershipId: string,
  role: TenantMembershipRole
): Promise<ReadonlySet<TenantPermission>> {
  const result = await database.query<{ permission_key: TenantPermission }>(
    `SELECT ceiling.permission_key
     FROM auth_tenant_role_permission_ceiling AS ceiling
     LEFT JOIN auth_tenant_permission_overrides AS denied
       ON denied.membership_id=$1
      AND denied.membership_role=ceiling.membership_role
      AND denied.permission_key=ceiling.permission_key
      AND denied.effect='deny'
     WHERE ceiling.membership_role=$2
       AND denied.membership_id IS NULL
     ORDER BY ceiling.permission_key`,
    [membershipId, role]
  );
  return new Set(result.rows.map((row) => row.permission_key));
}

function assertGrantAuthority(input: {
  actorRole: TenantMembershipRole;
  actorPermissions: ReadonlySet<TenantPermission>;
  targetRole: TenantMembershipRole;
  selectedPermissions: readonly TenantPermission[];
}): void {
  if (!canGrantTenantRole(input.actorRole, input.targetRole)) {
    throw new CompanyTeamAccessError();
  }
  const targetCeiling = new Set(tenantPermissionsForRole(input.targetRole));
  for (const permission of input.selectedPermissions) {
    if (!targetCeiling.has(permission) || !input.actorPermissions.has(permission)) {
      throw new CompanyTeamAccessError();
    }
  }
}

async function assertActiveUnits(
  database: DatabaseClient,
  tenantId: string,
  siteId: string | null,
  departmentId: string | null
): Promise<void> {
  if (siteId) {
    const site = await database.query(
      `SELECT 1 FROM company_sites
       WHERE tenant_id=$1 AND site_id=$2 AND site_status='active'
       FOR UPDATE`,
      [tenantId, siteId]
    );
    if (!site.rows[0]) throw new CompanyTeamInputError("Select an active Company site.");
  }
  if (departmentId) {
    const department = await database.query(
      `SELECT 1 FROM company_departments
       WHERE tenant_id=$1 AND department_id=$2 AND department_status='active'
       FOR UPDATE`,
      [tenantId, departmentId]
    );
    if (!department.rows[0]) throw new CompanyTeamInputError("Select an active Company department.");
  }
}

async function assertOwnerContinuity(input: {
  database: DatabaseClient;
  tenantId: string;
  targetMembershipId: string;
  currentRole: TenantMembershipRole;
  currentStatus: TenantMembershipStatus;
  nextRole: TenantMembershipRole;
  nextStatus: TenantMembershipStatus;
}): Promise<void> {
  if (
    input.currentRole !== "owner" ||
    input.currentStatus !== "active" ||
    (input.nextRole === "owner" && input.nextStatus === "active")
  ) return;

  const other = await input.database.query(
    `SELECT 1
     FROM auth_tenant_memberships
     WHERE tenant_id=$1
       AND membership_id<>$2
       AND portal_role='company'
       AND membership_role='owner'
       AND membership_status='active'
     LIMIT 1
     FOR UPDATE`,
    [input.tenantId, input.targetMembershipId]
  );
  if (!other.rows[0]) {
    throw new CompanyTeamConflictError("A Company must retain at least one active owner.");
  }
}

async function memberFromDatabase(
  database: DatabaseClient,
  tenantId: string,
  membershipId: string
): Promise<CompanyTeamMemberRecord | null> {
  const result = await database.query<MemberRow>(
    `SELECT ${MEMBER_COLUMNS}
     FROM auth_tenant_memberships AS m
     JOIN auth_accounts AS a ON a.account_id=m.account_id
     LEFT JOIN company_team_unit_assignments AS x
       ON x.tenant_id=m.tenant_id
      AND x.membership_id=m.membership_id
      AND x.ended_at IS NULL
     LEFT JOIN company_sites AS s
       ON s.tenant_id=x.tenant_id AND s.site_id=x.site_id
     LEFT JOIN company_departments AS d
       ON d.tenant_id=x.tenant_id AND d.department_id=x.department_id
     WHERE m.tenant_id=$1
       AND m.membership_id=$2
       AND m.portal_role='company'`,
    [tenantId, membershipId]
  );
  const row = result.rows[0];
  if (!row) return null;
  const overrides = await database.query<OverrideRow>(
    `SELECT permission_key, effect
     FROM auth_tenant_permission_overrides
     WHERE membership_id=$1 AND membership_role=$2
     ORDER BY permission_key`,
    [row.membership_id, row.membership_role]
  );
  const permissions = new Set<TenantPermission>(tenantPermissionsForRole(row.membership_role));
  for (const override of overrides.rows) {
    if (override.effect === "deny") permissions.delete(override.permission_key);
    else permissions.add(override.permission_key);
  }
  return Object.freeze({
    membershipId: row.membership_id,
    accountId: row.account_id,
    displayName: row.display_name,
    email: row.email_normalized,
    membershipRole: row.membership_role,
    status: row.membership_status,
    permissions: Object.freeze([...permissions]),
    siteId: row.site_id,
    siteName: row.site_name,
    departmentId: row.department_id,
    departmentName: row.department_name,
    activatedAt: row.activated_at === null ? null : timestamp(row.activated_at)
  });
}

async function selectedInvitationPermissions(
  database: DatabaseClient,
  invitationId: string
): Promise<readonly TenantPermission[]> {
  const result = await database.query<{ permission_key: TenantPermission }>(
    `SELECT permission_key
     FROM company_team_invitation_permissions
     WHERE invitation_id=$1
     ORDER BY permission_key`,
    [invitationId]
  );
  return Object.freeze(result.rows.map((row) => row.permission_key));
}

export class CompanyTeamService {
  constructor(
    private readonly clientPromise: Promise<DatabaseClient> = getDatabaseClient(),
    private readonly pepper: string = getServerEnvironment().authPepper,
    private readonly now: () => Date = () => new Date()
  ) {}
  private client(): Promise<DatabaseClient> { return this.clientPromise; }

  async listMembers(
    principal: TenantPermissionPrincipal<typeof READ_PERMISSION>
  ): Promise<readonly CompanyTeamMemberRecord[]> {
    return runTenantScopedCommand({
      database: await this.client(),
      principal,
      permission: READ_PERMISSION,
      operation: async ({ database, scope }) => {
        const result = await database.query<{ membership_id: string }>(
          `SELECT membership_id
           FROM auth_tenant_memberships
           WHERE tenant_id=$1 AND portal_role='company'
           ORDER BY CASE membership_status WHEN 'active' THEN 0 WHEN 'invited' THEN 1 WHEN 'suspended' THEN 2 ELSE 3 END, membership_id`,
          [scope.tenantId]
        );
        const members: CompanyTeamMemberRecord[] = [];
        for (const row of result.rows) {
          const member = await memberFromDatabase(database, scope.tenantId, row.membership_id);
          if (member) members.push(member);
        }
        members.sort((a, b) => {
          const rank = { active: 0, invited: 1, suspended: 2, revoked: 3 } as const;
          return rank[a.status] - rank[b.status] || a.displayName.localeCompare(b.displayName) || a.membershipId.localeCompare(b.membershipId);
        });
        return Object.freeze(members);
      }
    });
  }

  async listInvitations(
    principal: TenantPermissionPrincipal<typeof READ_PERMISSION>
  ): Promise<readonly CompanyTeamInvitationRecord[]> {
    const now = this.now();
    return runTenantScopedCommand({
      database: await this.client(),
      principal,
      permission: READ_PERMISSION,
      now,
      operation: async ({ database, scope }) => {
        const result = await database.query<InvitationRow>(
          `SELECT bindings.invitation_id, invitations.email_normalized,
                  bindings.membership_role, invitations.invitation_status,
                  invitations.expires_at, invitations.created_at,
                  bindings.site_id, sites.name AS site_name,
                  bindings.department_id, departments.name AS department_name
           FROM company_team_invitation_bindings AS bindings
           JOIN auth_staff_invitations AS invitations
             ON invitations.invitation_id=bindings.invitation_id
           LEFT JOIN company_sites AS sites
             ON sites.tenant_id=bindings.tenant_id AND sites.site_id=bindings.site_id
           LEFT JOIN company_departments AS departments
             ON departments.tenant_id=bindings.tenant_id AND departments.department_id=bindings.department_id
           WHERE bindings.tenant_id=$1
           ORDER BY invitations.created_at DESC, bindings.invitation_id`,
          [scope.tenantId]
        );
        const records: CompanyTeamInvitationRecord[] = [];
        for (const row of result.rows) {
          const expiresAt = timestamp(row.expires_at);
          const status = row.invitation_status === "pending" && Date.parse(expiresAt) <= now.getTime()
            ? "expired"
            : row.invitation_status;
          records.push(Object.freeze({
            invitationId: row.invitation_id,
            email: row.email_normalized,
            membershipRole: row.membership_role,
            status,
            permissions: await selectedInvitationPermissions(database, row.invitation_id),
            siteId: row.site_id,
            siteName: row.site_name,
            departmentId: row.department_id,
            departmentName: row.department_name,
            expiresAt,
            createdAt: timestamp(row.created_at)
          }));
        }
        return Object.freeze(records);
      }
    });
  }

  async invite(principal: TenantPermissionPrincipal<typeof MANAGE_PERMISSION>, input: {
    email: string;
    membershipRole: TenantMembershipRole;
    permissions: readonly string[];
    siteId?: string | null;
    departmentId?: string | null;
    requestFingerprint: string;
  }): Promise<CompanyTeamInvitationResult> {
    let email: string;
    try { email = normalizeEmail(input.email); }
    catch { throw new CompanyTeamInputError("Enter a valid staff email address."); }
    const selectedPermissions = uniquePermissions(input.permissions);
    const siteId = input.siteId?.trim() || null;
    const departmentId = input.departmentId?.trim() || null;
    const now = this.now();
    const nowIso = now.toISOString();
    const token = createOpaqueToken();
    const fingerprint = hashOpaqueValue(input.requestFingerprint, this.pepper, "company-team-invitation-rate");

    try {
      return await runTenantScopedCommand({
        database: await this.client(),
        principal,
        permission: MANAGE_PERMISSION,
        now,
        operation: async ({ database, scope }) => {
          const actor = await liveActor(database, scope);
          const actorPermissions = await livePermissions(database, scope.membershipId, actor.membership_role);
          assertGrantAuthority({ actorRole: actor.membership_role, actorPermissions, targetRole: input.membershipRole, selectedPermissions });
          await assertActiveUnits(database, scope.tenantId, siteId, departmentId);

          const access = new AuthAccessRepository(database);
          const attempts = await access.consumeAccessRateLimit({
            action: "staff_invitation",
            bucketKey: hashOpaqueValue(`${scope.accountId}\u0000${fingerprint}`, this.pepper, "auth-staff_invitation-rate-limit"),
            now: nowIso,
            resetBefore: addMs(now, -RATE_WINDOW_MS)
          });
          if (attempts > MAX_INVITATIONS) {
            throw new CompanyTeamInputError("Too many Company staff invitations. Wait before trying again.");
          }
          if (await access.authentication.findAccountByEmail(email)) {
            throw new CompanyTeamConflictError("A Company Team invitation cannot be created for an existing account.");
          }

          const invitationId = createIdentifier("invitation");
          const expiresAt = addMs(now, INVITATION_TTL_MS);
          await access.insertStaffInvitation({
            invitationId,
            email,
            role: "company",
            tokenHash: hashOpaqueValue(token, this.pepper, "staff-invitation"),
            invitedByAccountId: scope.accountId,
            expiresAt,
            createdAt: nowIso
          });
          const membershipId = createIdentifier("membership");
          const initialAssignmentId = siteId || departmentId ? createIdentifier("teamassignment") : null;
          await database.query(
            `INSERT INTO company_team_invitation_bindings (
               invitation_id, membership_id, initial_assignment_id, tenant_id,
               invited_by_membership_id, membership_role, site_id, department_id, created_at
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
            [invitationId, membershipId, initialAssignmentId, scope.tenantId, scope.membershipId, input.membershipRole, siteId, departmentId, nowIso]
          );
          for (const permission of selectedPermissions) {
            await database.query(
              `INSERT INTO company_team_invitation_permissions (
                 invitation_id, membership_role, permission_key, created_at
               ) VALUES ($1,$2,$3,$4)`,
              [invitationId, input.membershipRole, permission, nowIso]
            );
          }
          await access.authentication.insertSecurityEvent({
            eventId: createIdentifier("event"),
            accountId: scope.accountId,
            eventType: "invitation_created",
            activeRole: "company",
            metadata: { invitationId, invitedRole: "company", membershipRole: input.membershipRole },
            occurredAt: nowIso
          });
          const audit = new DatabaseAuditRepository(Promise.resolve(database));
          await audit.append(bindTrustedAuditActor(principal), {
            action: "company_team.invitation.created",
            outcome: "succeeded",
            target: { type: "invitation", reference: invitationId },
            requestFingerprintHash: fingerprint,
            metadata: {
              membershipRole: input.membershipRole,
              permissionCount: selectedPermissions.length,
              siteScoped: siteId !== null,
              departmentScoped: departmentId !== null
            }
          });
          return Object.freeze({
            invitationId,
            email,
            membershipRole: input.membershipRole,
            expiresAt,
            invitationPath: `/staff/invite/${token}`
          });
        }
      });
    } catch (error) {
      if (error instanceof CompanyTeamInputError || error instanceof CompanyTeamAccessError || error instanceof CompanyTeamConflictError) throw error;
      if (isUniqueViolation(error)) throw new CompanyTeamConflictError("A pending Company Team invitation already exists for that email.");
      throw error;
    }
  }

  async cancelInvitation(
    principal: TenantPermissionPrincipal<typeof MANAGE_PERMISSION>,
    invitationId: string
  ): Promise<void> {
    const normalizedInvitationId = invitationId.trim();
    if (!normalizedInvitationId) throw new CompanyTeamInputError("Invitation reference is required.");
    const now = this.now();
    const nowIso = now.toISOString();
    await runTenantScopedCommand({
      database: await this.client(),
      principal,
      permission: MANAGE_PERMISSION,
      now,
      operation: async ({ database, scope }) => {
        const actor = await liveActor(database, scope);
        const result = await database.query<{ membership_role: TenantMembershipRole; invitation_status: InvitationRow["invitation_status"] }>(
          `SELECT bindings.membership_role, invitations.invitation_status
           FROM company_team_invitation_bindings AS bindings
           JOIN auth_staff_invitations AS invitations
             ON invitations.invitation_id=bindings.invitation_id
           WHERE bindings.tenant_id=$1 AND bindings.invitation_id=$2
           FOR UPDATE OF bindings, invitations`,
          [scope.tenantId, normalizedInvitationId]
        );
        const invitation = result.rows[0];
        if (!invitation) throw new CompanyTeamAccessError();
        if (!canGrantTenantRole(actor.membership_role, invitation.membership_role)) throw new CompanyTeamAccessError();
        if (invitation.invitation_status !== "pending") {
          throw new CompanyTeamConflictError("Only a pending Company Team invitation can be cancelled.");
        }
        const revoked = await database.query(
          `UPDATE auth_staff_invitations
           SET invitation_status='revoked', revoked_at=$2
           WHERE invitation_id=$1 AND invitation_status='pending'`,
          [normalizedInvitationId, nowIso]
        );
        if (revoked.affectedRows !== 1) throw new CompanyTeamConflictError();
        await database.query(
          `UPDATE auth_staff_enrollment_flows
           SET current_step='cancelled', cancelled_at=$2, updated_at=$2
           WHERE invitation_id=$1 AND current_step IN ('profile','totp')`,
          [normalizedInvitationId, nowIso]
        );
        const audit = new DatabaseAuditRepository(Promise.resolve(database));
        await audit.append(bindTrustedAuditActor(principal), {
          action: "company_team.invitation.revoked",
          outcome: "succeeded",
          target: { type: "invitation", reference: normalizedInvitationId },
          metadata: { membershipRole: invitation.membership_role }
        });
      }
    });
  }

  async updateMember(principal: TenantPermissionPrincipal<typeof MANAGE_PERMISSION>, input: {
    membershipId: string;
    expectedRole: TenantMembershipRole;
    expectedStatus: TenantMembershipStatus;
    membershipRole: TenantMembershipRole;
    permissions: readonly string[];
    siteId?: string | null;
    departmentId?: string | null;
  }): Promise<CompanyTeamMemberRecord> {
    const membershipId = input.membershipId.trim();
    if (!membershipId) throw new CompanyTeamInputError("Team membership reference is required.");
    const selectedPermissions = uniquePermissions(input.permissions);
    const siteId = input.siteId?.trim() || null;
    const departmentId = input.departmentId?.trim() || null;
    const now = this.now();
    const nowIso = now.toISOString();

    return runTenantScopedCommand({
      database: await this.client(),
      principal,
      permission: MANAGE_PERMISSION,
      now,
      operation: async ({ database, scope }) => {
        const actor = await liveActor(database, scope);
        if (scope.membershipId === membershipId) throw new CompanyTeamAccessError();
        const targetResult = await database.query<TargetMembershipRow>(
          `SELECT membership_id, account_id, membership_role, membership_status
           FROM auth_tenant_memberships
           WHERE tenant_id=$1 AND membership_id=$2 AND portal_role='company'
           FOR UPDATE`,
          [scope.tenantId, membershipId]
        );
        const target = targetResult.rows[0];
        if (!target) throw new CompanyTeamAccessError();
        if (target.membership_role !== input.expectedRole || target.membership_status !== input.expectedStatus) {
          throw new CompanyTeamConflictError("That Company Team membership changed. Reload and try again.");
        }
        if (target.membership_status !== "active" && target.membership_status !== "suspended") {
          throw new CompanyTeamConflictError("Only active or suspended Company Team memberships can be edited.");
        }
        if (!canGrantTenantRole(actor.membership_role, target.membership_role)) throw new CompanyTeamAccessError();
        const actorPermissions = await livePermissions(database, scope.membershipId, actor.membership_role);
        assertGrantAuthority({ actorRole: actor.membership_role, actorPermissions, targetRole: input.membershipRole, selectedPermissions });
        await assertOwnerContinuity({
          database,
          tenantId: scope.tenantId,
          targetMembershipId: membershipId,
          currentRole: target.membership_role,
          currentStatus: target.membership_status,
          nextRole: input.membershipRole,
          nextStatus: target.membership_status
        });
        await assertActiveUnits(database, scope.tenantId, siteId, departmentId);

        const assignmentResult = await database.query<ActiveAssignmentRow>(
          `SELECT assignment_id, site_id, department_id
           FROM company_team_unit_assignments
           WHERE tenant_id=$1 AND membership_id=$2 AND ended_at IS NULL
           FOR UPDATE`,
          [scope.tenantId, membershipId]
        );
        const currentAssignment = assignmentResult.rows[0] ?? null;
        const assignmentChanged =
          (currentAssignment?.site_id ?? null) !== siteId ||
          (currentAssignment?.department_id ?? null) !== departmentId;

        await database.query(
          `DELETE FROM auth_tenant_permission_overrides
           WHERE membership_id=$1`,
          [membershipId]
        );
        const membershipUpdate = await database.query(
          `UPDATE auth_tenant_memberships
           SET membership_role=$3, updated_at=$4
           WHERE tenant_id=$1 AND membership_id=$2
             AND membership_role=$5 AND membership_status=$6`,
          [scope.tenantId, membershipId, input.membershipRole, nowIso, target.membership_role, target.membership_status]
        );
        if (membershipUpdate.affectedRows !== 1) throw new CompanyTeamConflictError();

        const selectedSet = new Set(selectedPermissions);
        for (const permission of tenantPermissionsForRole(input.membershipRole)) {
          if (selectedSet.has(permission)) continue;
          await database.query(
            `INSERT INTO auth_tenant_permission_overrides (
               membership_id, membership_role, permission_key, effect,
               created_by_account_id, reason, created_at
             ) VALUES ($1,$2,$3,'deny',$4,$5,$6)`,
            [membershipId, input.membershipRole, permission, scope.accountId, "Not selected in Company Team access", nowIso]
          );
        }

        if (assignmentChanged) {
          if (currentAssignment) {
            await database.query(
              `UPDATE company_team_unit_assignments
               SET ended_at=$2, ended_reason='Company Team scope changed'
               WHERE assignment_id=$1 AND ended_at IS NULL`,
              [currentAssignment.assignment_id, nowIso]
            );
          }
          if (siteId || departmentId) {
            if (target.membership_status !== "active") {
              throw new CompanyTeamConflictError("A suspended Company Team member cannot receive an active unit assignment.");
            }
            await database.query(
              `INSERT INTO company_team_unit_assignments (
                 assignment_id, tenant_id, membership_id, site_id, department_id,
                 assigned_by_membership_id, assigned_at
               ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
              [createIdentifier("teamassignment"), scope.tenantId, membershipId, siteId, departmentId, scope.membershipId, nowIso]
            );
          }
        }

        const audit = new DatabaseAuditRepository(Promise.resolve(database));
        await audit.append(bindTrustedAuditActor(principal), {
          action: "company_team.membership.updated",
          outcome: "succeeded",
          target: { type: "membership", reference: membershipId },
          metadata: {
            previousRole: target.membership_role,
            membershipRole: input.membershipRole,
            permissionCount: selectedPermissions.length,
            assignmentChanged
          }
        });
        const updated = await memberFromDatabase(database, scope.tenantId, membershipId);
        if (!updated) throw new CompanyTeamConflictError();
        return updated;
      }
    });
  }

  async changeMemberStatus(principal: TenantPermissionPrincipal<typeof MANAGE_PERMISSION>, input: {
    membershipId: string;
    expectedStatus: TenantMembershipStatus;
    targetStatus: "active" | "suspended" | "revoked";
  }): Promise<CompanyTeamMemberRecord> {
    const membershipId = input.membershipId.trim();
    if (!membershipId) throw new CompanyTeamInputError("Team membership reference is required.");
    const now = this.now();
    const nowIso = now.toISOString();

    return runTenantScopedCommand({
      database: await this.client(),
      principal,
      permission: MANAGE_PERMISSION,
      now,
      operation: async ({ database, scope }) => {
        const actor = await liveActor(database, scope);
        if (scope.membershipId === membershipId) throw new CompanyTeamAccessError();
        const targetResult = await database.query<TargetMembershipRow>(
          `SELECT membership_id, account_id, membership_role, membership_status
           FROM auth_tenant_memberships
           WHERE tenant_id=$1 AND membership_id=$2 AND portal_role='company'
           FOR UPDATE`,
          [scope.tenantId, membershipId]
        );
        const target = targetResult.rows[0];
        if (!target) throw new CompanyTeamAccessError();
        if (target.membership_status !== input.expectedStatus) {
          throw new CompanyTeamConflictError("That Company Team membership changed. Reload and try again.");
        }
        if (!canGrantTenantRole(actor.membership_role, target.membership_role)) throw new CompanyTeamAccessError();

        const validTransition =
          (target.membership_status === "active" && (input.targetStatus === "suspended" || input.targetStatus === "revoked")) ||
          (target.membership_status === "suspended" && (input.targetStatus === "active" || input.targetStatus === "revoked"));
        if (!validTransition) throw new CompanyTeamConflictError("That Company Team status transition is not allowed.");

        await assertOwnerContinuity({
          database,
          tenantId: scope.tenantId,
          targetMembershipId: membershipId,
          currentRole: target.membership_role,
          currentStatus: target.membership_status,
          nextRole: target.membership_role,
          nextStatus: input.targetStatus
        });

        const update = input.targetStatus === "suspended"
          ? await database.query(
              `UPDATE auth_tenant_memberships
               SET membership_status='suspended', suspended_at=$3, revoked_at=NULL, updated_at=$3
               WHERE tenant_id=$1 AND membership_id=$2 AND membership_status='active'`,
              [scope.tenantId, membershipId, nowIso]
            )
          : input.targetStatus === "active"
            ? await database.query(
                `UPDATE auth_tenant_memberships
                 SET membership_status='active', suspended_at=NULL, revoked_at=NULL, updated_at=$3
                 WHERE tenant_id=$1 AND membership_id=$2 AND membership_status='suspended'`,
                [scope.tenantId, membershipId, nowIso]
              )
            : await database.query(
                `UPDATE auth_tenant_memberships
                 SET membership_status='revoked', suspended_at=NULL, revoked_at=$3, updated_at=$3
                 WHERE tenant_id=$1 AND membership_id=$2 AND membership_status IN ('active','suspended')`,
                [scope.tenantId, membershipId, nowIso]
              );
        if (update.affectedRows !== 1) throw new CompanyTeamConflictError();

        const action = input.targetStatus === "suspended"
          ? "company_team.membership.suspended"
          : input.targetStatus === "active"
            ? "company_team.membership.reactivated"
            : "company_team.membership.revoked";
        const audit = new DatabaseAuditRepository(Promise.resolve(database));
        await audit.append(bindTrustedAuditActor(principal), {
          action,
          outcome: "succeeded",
          target: { type: "membership", reference: membershipId },
          metadata: { previousStatus: target.membership_status, status: input.targetStatus }
        });
        const changed = await memberFromDatabase(database, scope.tenantId, membershipId);
        if (!changed) throw new CompanyTeamConflictError();
        return changed;
      }
    });
  }
}

let service: CompanyTeamService | null = null;
export function getCompanyTeamService(): CompanyTeamService {
  service ??= new CompanyTeamService();
  return service;
}
