import { RolePortalShell } from "@/components/auth/role-portal-shell";
import { requireRoleSession } from "@/lib/auth/auth-session-service";

export default async function VerifierPortalLayout({
  children
}: {
  children: React.ReactNode;
}): Promise<React.JSX.Element> {
  const session = await requireRoleSession("verifier");
  return <RolePortalShell session={session}>{children}</RolePortalShell>;
}
