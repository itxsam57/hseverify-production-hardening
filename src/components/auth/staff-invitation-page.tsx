import type { StaffInvitationActionState } from "@/app/staff/actions";
import { StaffInvitationForm } from "@/components/auth/staff-invitation-form";
import { allowedStaffRolesForPortal } from "@/lib/auth/staff-role-policy";
import { getStaffProvisioningService } from "@/lib/auth/staff-provisioning-service";
import type { AuthenticatedSession } from "@/lib/auth/auth-session-service";

type InvitationAction = (
  previousState: StaffInvitationActionState,
  formData: FormData
) => Promise<StaffInvitationActionState>;

export async function StaffInvitationPage({
  session,
  action
}: {
  session: AuthenticatedSession & { role: "admin" | "root" };
  action: InvitationAction;
}): Promise<React.JSX.Element> {
  const invitations = await (
    await getStaffProvisioningService()
  ).listInvitations(session.accountId);
  const allowedRoles = allowedStaffRolesForPortal(session.role);

  return (
    <div className="dashboard-page">
      <header className="page-heading-row">
        <div>
          <p className="eyebrow">Staff provisioning</p>
          <h1>Invitation-only portal accounts</h1>
          <p className="page-intro">
            Create a single-use invitation. The recipient must create a strong password and activate TOTP before sign-in is possible.
          </p>
        </div>
      </header>

      <section className="dashboard-section" aria-labelledby="create-staff-invitation">
        <h2 id="create-staff-invitation">Create invitation</h2>
        <StaffInvitationForm action={action} allowedRoles={allowedRoles} />
      </section>

      <section className="dashboard-section" aria-labelledby="recent-staff-invitations">
        <h2 id="recent-staff-invitations">Recent invitations</h2>
        {invitations.length === 0 ? (
          <p>No staff invitation has been created by this account.</p>
        ) : (
          <div className="record-list">
            {invitations.map((invitation) => (
              <article className="record-row" key={invitation.invitationId}>
                <div>
                  <h3>{invitation.email}</h3>
                  <p>
                    {invitation.role} · Created {new Date(invitation.createdAt).toLocaleString()} · Expires {new Date(invitation.expiresAt).toLocaleString()}
                  </p>
                </div>
                <strong>{invitation.status}</strong>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
