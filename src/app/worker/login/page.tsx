import { signInWorkerAccount } from "@/app/auth/actions";
import { RoleLoginPage } from "@/components/auth/role-login-page";

export default async function WorkerLoginPage({
  searchParams
}: {
  searchParams: Promise<{ reason?: string; returnTo?: string }>;
}): Promise<React.JSX.Element> {
  const { reason, returnTo } = await searchParams;
  return RoleLoginPage({
    role: "worker",
    action: signInWorkerAccount,
    reason,
    returnTo
  });
}
