import { RoleDashboard } from "@/components/auth/role-dashboard";
import { requireRoleSession } from "@/lib/auth/auth-session-service";

export default async function AssessorDashboardPage(): Promise<React.JSX.Element> {
  return <RoleDashboard session={await requireRoleSession("assessor")} />;
}
