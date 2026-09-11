import { RolePortalShell } from "@/components/auth/role-portal-shell";
import { requireRoleSession } from "@/lib/auth/auth-session-service";

export default async function RootPortalLayout({
  children
}: {
  children: React.ReactNode;
}): Promise<React.JSX.Element> {
  const session = await requireRoleSession("root");
  return <RolePortalShell session={session}>{children}</RolePortalShell>;
}
