import Link from "next/link";

import { revokeAccountSession } from "@/app/account/sessions/actions";
import { Button } from "@/components/ui/button";
import {
  authenticatedHomePath,
  listOwnActiveSessions,
  requireAuthenticatedSession
} from "@/lib/auth/auth-session-service";

export default async function AccountSessionsPage(): Promise<React.JSX.Element> {
  const session = await requireAuthenticatedSession();
  const sessions = await listOwnActiveSessions(session);

  return (
    <main className="public-page" id="main-content">
      <section className="public-card">
        <p className="eyebrow">Account security</p>
        <h1>Active sessions</h1>
        <p className="page-intro">
          Review and revoke database-backed sessions for this account. A session cannot be changed into another portal role.
        </p>
        <p>
          <Link href={authenticatedHomePath(session.role)}>Return to active portal</Link>
        </p>
      </section>

      <section className="public-card" aria-labelledby="session-list-heading">
        <h2 id="session-list-heading">Current devices and sessions</h2>
        {sessions.length === 0 ? (
          <p>No active sessions remain.</p>
        ) : (
          <div className="record-list">
            {sessions.map((item) => {
              const current = item.sessionId === session.sessionId;
              return (
                <article className="record-row" key={item.sessionId}>
                  <div>
                    <h3>{current ? "Current session" : "Other session"}</h3>
                    <p>
                      Portal: {item.activeRole} · Created {new Date(item.createdAt).toLocaleString()}
                    </p>
                    <p>
                      Last used {new Date(item.lastSeenAt).toLocaleString()} · Expires {new Date(item.expiresAt).toLocaleString()}
                    </p>
                  </div>
                  <form action={revokeAccountSession}>
                    <input name="sessionId" type="hidden" value={item.sessionId} />
                    <Button size="small" type="submit" variant={current ? "danger" : "secondary"}>
                      {current ? "Sign out this session" : "Revoke session"}
                    </Button>
                  </form>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
