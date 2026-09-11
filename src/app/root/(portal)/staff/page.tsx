import { createRootStaffInvitation } from "@/app/staff/actions";
import { StaffInvitationPage } from "@/components/auth/staff-invitation-page";
import { requireRoleSession } from "@/lib/auth/auth-session-service";

export default async function RootStaffPage(): Promise<React.JSX.Element> {
  const session = await requireRoleSession("root");
  return StaffInvitationPage({
    session: { ...session, role: "root" },
    action: createRootStaffInvitation
  });
}
