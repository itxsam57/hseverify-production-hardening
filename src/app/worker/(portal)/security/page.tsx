import { AccountSecurityWorkspace } from "@/components/auth/account-security-workspace";
import { getAccountSecurityService } from "@/lib/auth/account-security-service";
import { requireAuthenticatedSession } from "@/lib/auth/auth-session-service";

export default async function WorkerSecurityPage(): Promise<React.JSX.Element> {
  const session = await requireAuthenticatedSession();
  const overview = await getAccountSecurityService().overview(session);
  return (
    <div className="dashboard-page">
      <header className="page-heading-row"><div>
        <p className="eyebrow">Worker account</p>
        <h1>Security</h1>
        <p className="page-intro">Password, sessions and security activity are separate from Privacy and Accessibility.</p>
      </div></header>
      <AccountSecurityWorkspace overview={overview} />
    </div>
  );
}
