import { signInAssessorAccount } from "@/app/auth/actions";
import { RoleLoginPage } from "@/components/auth/role-login-page";

export default async function AssessorLoginPage({
  searchParams
}: {
  searchParams: Promise<{ reason?: string }>;
}): Promise<React.JSX.Element> {
  const { reason } = await searchParams;
  return RoleLoginPage({ role: "assessor", action: signInAssessorAccount, reason });
}
