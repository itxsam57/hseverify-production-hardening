import { createRootStaffInvitation } from "@/app/staff/actions";
import { StaffInvitationPage } from "@/components/auth/staff-invitation-page";
import { requirePlatformPermission } from "@/lib/authorization/authorization-service";
import { requireRoleSession } from "@/lib/auth/auth-session-service";

export default async function RootStaffPage({
  searchParams
}: {
  searchParams: Promise<{ q?: string | string[] }>
}): Promise<React.JSX.Element> {
  await requirePlatformPermission({ expectedRole: "root", permission: "platform.staff.manage" });
  const parameters = await searchParams;
  const query = typeof parameters.q === "string" ? parameters.q.trim().slice(0, 160) : "";
  const session = await requireRoleSession("root");
  return StaffInvitationPage({
    session: { ...session, role: "root" },
    action: createRootStaffInvitation,
    query
  });
}
