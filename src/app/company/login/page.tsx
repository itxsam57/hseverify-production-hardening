import { signInCompanyAccount } from "@/app/auth/actions";
import { RoleLoginPage } from "@/components/auth/role-login-page";

export default async function CompanyLoginPage({
  searchParams
}: {
  searchParams: Promise<{ reason?: string }>;
}): Promise<React.JSX.Element> {
  const { reason } = await searchParams;
  return RoleLoginPage({ role: "company", action: signInCompanyAccount, reason });
}
