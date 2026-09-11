import { signInVerifierAccount } from "@/app/auth/actions";
import { RoleLoginPage } from "@/components/auth/role-login-page";

export default async function VerifierLoginPage({
  searchParams
}: {
  searchParams: Promise<{ reason?: string }>;
}): Promise<React.JSX.Element> {
  const { reason } = await searchParams;
  return RoleLoginPage({ role: "verifier", action: signInVerifierAccount, reason });
}
