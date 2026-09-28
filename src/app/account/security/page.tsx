import Link from "next/link";

import { AccountSecurityWorkspace } from "@/components/auth/account-security-workspace";
import { getAccountSecurityService } from "@/lib/auth/account-security-service";
import {
  authenticatedHomePath,
  requireAuthenticatedSession
} from "@/lib/auth/auth-session-service";

export default async function AccountSecurityPage(): Promise<React.JSX.Element> {
  const session = await requireAuthenticatedSession();
  const overview = await getAccountSecurityService().overview(session);
  return (
    <main className="public-page" id="main-content">
      <section className="public-card">
        <p className="eyebrow">Account security</p>
        <h1>Security settings</h1>
        <p className="page-intro">Manage password, MFA recovery, authenticator replacement, sessions and security activity.</p>
        <Link href={authenticatedHomePath(session.role)}>Return to active portal</Link>
      </section>
      <AccountSecurityWorkspace overview={overview} />
    </main>
  );
}
