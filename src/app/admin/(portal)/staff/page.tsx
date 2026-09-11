import { createAdminStaffInvitation } from "@/app/staff/actions";
import { StaffInvitationPage } from "@/components/auth/staff-invitation-page";
import { requireRoleSession } from "@/lib/auth/auth-session-service";

export default async function AdminStaffPage(): Promise<React.JSX.Element> {
  const session = await requireRoleSession("admin");
  return StaffInvitationPage({
    session: { ...session, role: "admin" },
    action: createAdminStaffInvitation
  });
}
