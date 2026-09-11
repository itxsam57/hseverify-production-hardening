"use client";

import { useActionState, useState } from "react";
import {
  cancelCompanyTeamInvitationAction,
  changeCompanyTeamMemberStatusAction,
  inviteCompanyTeamMemberAction,
  updateCompanyTeamMemberAction
} from "@/app/company/(portal)/team/actions";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Alert } from "@/components/ui/feedback";
import { Field, Input, Select } from "@/components/ui/field";
import {
  TENANT_MEMBERSHIP_ROLES,
  canGrantTenantRole,
  tenantPermissionsForRole,
  type TenantMembershipRole,
  type TenantPermission
} from "@/lib/authorization/authorization-domain";
import type { CompanyUnitRecord } from "@/lib/company/company-organization-domain";
import type {
  CompanyTeamInvitationRecord,
  CompanyTeamMemberRecord
} from "@/lib/company/company-team-service";
import { INITIAL_COMPANY_TEAM_ACTION_STATE } from "@/lib/ui/action-initial-states";

function permissionLabel(value: TenantPermission): string {
  return value.replace("company.", "").replaceAll(".", " · ");
}

function Feedback({
  state
}: {
  state: typeof INITIAL_COMPANY_TEAM_ACTION_STATE;
}): React.JSX.Element | null {
  if (!state.message) return null;
  return (
    <Alert
      tone={
        state.status === "success"
          ? "success"
          : state.status === "conflict"
            ? "warning"
            : "danger"
      }
    >
      {state.message}
    </Alert>
  );
}

function InvitationCard({
  invitation,
  actorRole,
  canManage
}: {
  invitation: CompanyTeamInvitationRecord;
  actorRole: TenantMembershipRole;
  canManage: boolean;
}): React.JSX.Element {
  const [cancelState, cancelAction] = useActionState(
    cancelCompanyTeamInvitationAction,
    INITIAL_COMPANY_TEAM_ACTION_STATE
  );
  const canCancel =
    canManage &&
    invitation.status === "pending" &&
    canGrantTenantRole(actorRole, invitation.membershipRole);

  return (
    <article className="panel page-section">
      <div className="section-heading-row">
        <div>
          <h3>{invitation.email}</h3>
          <p className="muted-copy">
            {invitation.membershipRole}
            {invitation.siteName ? ` · ${invitation.siteName}` : ""}
            {invitation.departmentName ? ` · ${invitation.departmentName}` : ""}
          </p>
        </div>
        <span className="status-pill">{invitation.status}</span>
      </div>
      <p className="muted-copy">
        Permissions: {invitation.permissions.length
          ? invitation.permissions.map(permissionLabel).join(", ")
          : "No tenant permissions"}
      </p>
      <p className="muted-copy">
        Expires: {new Date(invitation.expiresAt).toLocaleString()}
      </p>
      <Feedback state={cancelState} />
      {canCancel ? (
        <ConfirmDialog
          action={cancelAction}
          confirmLabel="Cancel invitation"
          danger
          description="The invitation will stop working immediately. Any unfinished password or TOTP enrollment flow for it will also be cancelled."
          hiddenFields={[{ name: "invitationId", value: invitation.invitationId }]}
          pendingLabel="Cancelling…"
          title={`Cancel invitation for ${invitation.email}?`}
          triggerLabel="Cancel invitation"
        />
      ) : null}
    </article>
  );
}

function MemberCard({
  member,
  sites,
  departments,
  actorMembershipId,
  actorRole,
  actorPermissions,
  canManage
}: {
  member: CompanyTeamMemberRecord;
  sites: readonly CompanyUnitRecord[];
  departments: readonly CompanyUnitRecord[];
  actorMembershipId: string;
  actorRole: TenantMembershipRole;
  actorPermissions: readonly TenantPermission[];
  canManage: boolean;
}): React.JSX.Element {
  const [updateState, updateAction, updatePending] = useActionState(
    updateCompanyTeamMemberAction,
    INITIAL_COMPANY_TEAM_ACTION_STATE
  );
  const [statusState, statusAction, statusPending] = useActionState(
    changeCompanyTeamMemberStatusAction,
    INITIAL_COMPANY_TEAM_ACTION_STATE
  );
  const availableRoles = TENANT_MEMBERSHIP_ROLES.filter((role) =>
    canGrantTenantRole(actorRole, role)
  );
  const [selectedRole, setSelectedRole] = useState<TenantMembershipRole>(
    member.membershipRole
  );
  const actorPermissionSet = new Set(actorPermissions);
  const selectablePermissions = tenantPermissionsForRole(selectedRole).filter(
    (permission) => actorPermissionSet.has(permission)
  );
  const activeSites = sites.filter((site) => site.status === "active");
  const activeDepartments = departments.filter(
    (department) => department.status === "active"
  );
  const isSelf = member.membershipId === actorMembershipId;
  const canEdit =
    canManage &&
    !isSelf &&
    member.status !== "revoked" &&
    canGrantTenantRole(actorRole, member.membershipRole) &&
    availableRoles.includes(member.membershipRole);

  return (
    <article className="panel page-section">
      <div className="section-heading-row">
        <div>
          <h3>{member.displayName}</h3>
          <p className="muted-copy">{member.email}</p>
        </div>
        <span className="status-pill">{member.status}</span>
      </div>
      <p>
        <strong>{member.membershipRole}</strong>
        {member.siteName ? ` · ${member.siteName}` : ""}
        {member.departmentName ? ` · ${member.departmentName}` : ""}
      </p>
      <p className="muted-copy">
        Permissions: {member.permissions.length
          ? member.permissions.map(permissionLabel).join(", ")
          : "No tenant permissions"}
      </p>
      {isSelf ? (
        <Alert tone="neutral">
          This is your current membership. Self role, permission and status changes are blocked to prevent accidental lockout.
        </Alert>
      ) : null}

      {canEdit ? (
        <div className="content-stack">
          <Feedback state={updateState} />
          <form action={updateAction} className="profile-form" noValidate>
            <input type="hidden" name="membershipId" value={member.membershipId} />
            <input type="hidden" name="expectedRole" value={member.membershipRole} />
            <input type="hidden" name="expectedStatus" value={member.status} />
            <Field htmlFor={`${member.membershipId}-role`} label="Company Team role">
              <Select
                id={`${member.membershipId}-role`}
                name="membershipRole"
                value={selectedRole}
                onChange={(event) =>
                  setSelectedRole(event.target.value as TenantMembershipRole)
                }
              >
                {availableRoles.map((role) => (
                  <option key={role} value={role}>
                    {role}
                  </option>
                ))}
              </Select>
            </Field>
            <Field htmlFor={`${member.membershipId}-site`} label="Site scope (optional)">
              <Select
                id={`${member.membershipId}-site`}
                name="siteId"
                defaultValue={member.siteId ?? ""}
                disabled={member.status !== "active"}
              >
                <option value="">No site assignment</option>
                {activeSites.map((site) => (
                  <option key={site.unitId} value={site.unitId}>
                    {site.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              htmlFor={`${member.membershipId}-department`}
              label="Department scope (optional)"
            >
              <Select
                id={`${member.membershipId}-department`}
                name="departmentId"
                defaultValue={member.departmentId ?? ""}
                disabled={member.status !== "active"}
              >
                <option value="">No department assignment</option>
                {activeDepartments.map((department) => (
                  <option key={department.unitId} value={department.unitId}>
                    {department.name}
                  </option>
                ))}
              </Select>
            </Field>
            <fieldset className="panel page-section" key={`${member.membershipId}-${selectedRole}`}>
              <legend>Effective tenant permissions</legend>
              <p className="muted-copy">
                Only permissions inside the selected role ceiling and your own current authority can be selected.
              </p>
              {selectablePermissions.map((permission) => (
                <label key={permission} className="checkbox-row">
                  <input
                    type="checkbox"
                    name="permissions"
                    value={permission}
                    defaultChecked={member.permissions.includes(permission)}
                  />{" "}
                  <span>{permissionLabel(permission)}</span>
                </label>
              ))}
            </fieldset>
            <Button type="submit" disabled={updatePending}>
              {updatePending ? "Saving…" : "Save Team access"}
            </Button>
          </form>

          <Feedback state={statusState} />
          {member.status === "active" ? (
            <div className="button-row">
              <ConfirmDialog
                action={statusAction}
                confirmLabel="Suspend access"
                description="This Company Team member will immediately lose tenant access. Active site/department assignments will end and remain in history. Reactivation will not recreate them."
                hiddenFields={[
                  { name: "membershipId", value: member.membershipId },
                  { name: "expectedStatus", value: member.status },
                  { name: "targetStatus", value: "suspended" }
                ]}
                pendingLabel="Suspending…"
                title={`Suspend ${member.displayName}?`}
                triggerLabel="Suspend"
              />
              <ConfirmDialog
                action={statusAction}
                confirmLabel="Revoke access"
                danger
                description="This permanently revokes the current Company membership. Active assignments will end and historical records will remain."
                hiddenFields={[
                  { name: "membershipId", value: member.membershipId },
                  { name: "expectedStatus", value: member.status },
                  { name: "targetStatus", value: "revoked" }
                ]}
                pendingLabel="Revoking…"
                title={`Revoke ${member.displayName}'s Company access?`}
                triggerLabel="Revoke"
              />
            </div>
          ) : member.status === "suspended" ? (
            <div className="button-row">
              <form action={statusAction}>
                <input type="hidden" name="membershipId" value={member.membershipId} />
                <input type="hidden" name="expectedStatus" value={member.status} />
                <input type="hidden" name="targetStatus" value="active" />
                <Button type="submit" variant="secondary" disabled={statusPending}>
                  {statusPending ? "Reactivating…" : "Reactivate"}
                </Button>
              </form>
              <ConfirmDialog
                action={statusAction}
                confirmLabel="Revoke access"
                danger
                description="This permanently revokes the suspended Company membership. Existing history remains retained."
                hiddenFields={[
                  { name: "membershipId", value: member.membershipId },
                  { name: "expectedStatus", value: member.status },
                  { name: "targetStatus", value: "revoked" }
                ]}
                pendingLabel="Revoking…"
                title={`Revoke ${member.displayName}'s Company access?`}
                triggerLabel="Revoke"
              />
            </div>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

export function CompanyTeamWorkspace({
  members,
  invitations,
  sites,
  departments,
  actorMembershipId,
  actorRole,
  actorPermissions,
  canManage
}: {
  members: readonly CompanyTeamMemberRecord[];
  invitations: readonly CompanyTeamInvitationRecord[];
  sites: readonly CompanyUnitRecord[];
  departments: readonly CompanyUnitRecord[];
  actorMembershipId: string;
  actorRole: TenantMembershipRole;
  actorPermissions: readonly TenantPermission[];
  canManage: boolean;
}): React.JSX.Element {
  const [inviteState, inviteAction, invitePending] = useActionState(
    inviteCompanyTeamMemberAction,
    INITIAL_COMPANY_TEAM_ACTION_STATE
  );
  const availableRoles = TENANT_MEMBERSHIP_ROLES.filter((role) =>
    canGrantTenantRole(actorRole, role)
  );
  const [selectedRole, setSelectedRole] = useState<TenantMembershipRole>(
    availableRoles[0] ?? "viewer"
  );
  const actorPermissionSet = new Set(actorPermissions);
  const selectablePermissions = tenantPermissionsForRole(selectedRole).filter(
    (permission) => actorPermissionSet.has(permission)
  );
  const activeSites = sites.filter((site) => site.status === "active");
  const activeDepartments = departments.filter(
    (department) => department.status === "active"
  );

  return (
    <div className="content-stack">
      <section className="panel page-section" aria-labelledby="company-team-invite-title">
        <div className="section-heading-row">
          <div>
            <p className="eyebrow">Invitation-only Company access</p>
            <h2 id="company-team-invite-title">Invite Company Team member</h2>
          </div>
        </div>
        <p className="muted-copy">
          Company staff are separate from the Worker directory. Every invitation uses the existing staff password and TOTP enrollment flow before tenant membership becomes active.
        </p>
        <Feedback state={inviteState} />
        {inviteState.invitationPath ? (
          <Alert tone="neutral">
            Local test invitation path: <strong>{inviteState.invitationPath}</strong>
          </Alert>
        ) : null}
        {!canManage || availableRoles.length === 0 ? (
          <Alert tone="warning">
            Your current Company role cannot invite additional Team members.
          </Alert>
        ) : (
          <form action={inviteAction} className="profile-form" noValidate>
            <Field htmlFor="team-email" label="Staff email">
              <Input id="team-email" name="email" type="email" required maxLength={320} />
            </Field>
            <Field htmlFor="team-role" label="Company Team role">
              <Select
                id="team-role"
                name="membershipRole"
                value={selectedRole}
                onChange={(event) =>
                  setSelectedRole(event.target.value as TenantMembershipRole)
                }
              >
                {availableRoles.map((role) => (
                  <option key={role} value={role}>
                    {role}
                  </option>
                ))}
              </Select>
            </Field>
            <Field htmlFor="team-site" label="Site scope (optional)">
              <Select id="team-site" name="siteId" defaultValue="">
                <option value="">No site assignment</option>
                {activeSites.map((site) => (
                  <option value={site.unitId} key={site.unitId}>
                    {site.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field htmlFor="team-department" label="Department scope (optional)">
              <Select id="team-department" name="departmentId" defaultValue="">
                <option value="">No department assignment</option>
                {activeDepartments.map((department) => (
                  <option value={department.unitId} key={department.unitId}>
                    {department.name}
                  </option>
                ))}
              </Select>
            </Field>
            <fieldset className="panel page-section" key={`invite-${selectedRole}`}>
              <legend>Effective tenant permissions</legend>
              <p className="muted-copy">
                Only permissions inside the target role ceiling and your own current authority can be selected.
              </p>
              {selectablePermissions.map((permission) => (
                <label key={permission} className="checkbox-row">
                  <input
                    type="checkbox"
                    name="permissions"
                    value={permission}
                    defaultChecked
                  />{" "}
                  <span>{permissionLabel(permission)}</span>
                </label>
              ))}
            </fieldset>
            <Button type="submit" disabled={invitePending}>
              {invitePending ? "Creating invitation…" : "Create Company Team invitation"}
            </Button>
          </form>
        )}
      </section>

      <section className="content-stack" aria-labelledby="company-team-invitations-title">
        <div className="section-heading-row">
          <div>
            <p className="eyebrow">Durable invitation history</p>
            <h2 id="company-team-invitations-title">Team invitations</h2>
          </div>
          <span className="status-pill">{invitations.length}</span>
        </div>
        {invitations.length === 0 ? (
          <Alert tone="neutral">No Company Team invitations have been created.</Alert>
        ) : (
          invitations.map((invitation) => (
            <InvitationCard
              key={invitation.invitationId}
              invitation={invitation}
              actorRole={actorRole}
              canManage={canManage}
            />
          ))
        )}
      </section>

      <section className="content-stack" aria-labelledby="company-team-list-title">
        <div className="section-heading-row">
          <div>
            <p className="eyebrow">Company staff only</p>
            <h2 id="company-team-list-title">Team and permissions</h2>
          </div>
          <span className="status-pill">{members.length}</span>
        </div>
        {members.length === 0 ? (
          <Alert tone="neutral">No Company Team memberships are available.</Alert>
        ) : (
          members.map((member) => (
            <MemberCard
              key={member.membershipId}
              member={member}
              sites={sites}
              departments={departments}
              actorMembershipId={actorMembershipId}
              actorRole={actorRole}
              actorPermissions={actorPermissions}
              canManage={canManage}
            />
          ))
        )}
      </section>
    </div>
  );
}
