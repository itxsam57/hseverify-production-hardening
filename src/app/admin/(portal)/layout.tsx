import { RolePortalShell } from "@/components/auth/role-portal-shell";
import { requireRoleSession } from "@/lib/auth/auth-session-service";

export default async function AdminPortalLayout({
  children
}: {
  children: React.ReactNode;
}): Promise<React.JSX.Element> {
  const session = await requireRoleSession("admin");
  return <RolePortalShell session={session}>{children}</RolePortalShell>;
}
