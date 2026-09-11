import { signInRootAccount } from "@/app/auth/actions";
import { RoleLoginPage } from "@/components/auth/role-login-page";

export default async function RootLoginPage({
  searchParams
}: {
  searchParams: Promise<{ reason?: string }>;
}): Promise<React.JSX.Element> {
  const { reason } = await searchParams;
  return RoleLoginPage({ role: "root", action: signInRootAccount, reason });
}
