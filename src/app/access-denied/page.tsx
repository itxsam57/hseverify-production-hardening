import Link from "next/link";

import { signOutCurrentPortal } from "@/app/auth/actions";
import { Button } from "@/components/ui/button";
import {
  authenticatedHomePath,
  readAuthenticatedSession
} from "@/lib/auth/auth-session-service";

export default async function AccessDeniedPage(): Promise<React.JSX.Element> {
  const session = await readAuthenticatedSession();
  return (
    <main className="public-page" id="main-content">
      <section className="public-card">
        <p className="eyebrow">Portal isolation</p>
        <h1>Access denied</h1>
        <p>
          This address belongs to a different HSE Verify portal. A session is fixed to one role and cannot cross into another dashboard or protected endpoint.
        </p>
        {session ? (
          <>
            <p>Your active portal role is <strong>{session.role}</strong>.</p>
            <div className="button-row">
              <Link className="button button-primary" href={authenticatedHomePath(session.role)}>
                Return to active portal
              </Link>
              <form action={signOutCurrentPortal}>
                <Button type="submit" variant="secondary">
                  Sign out to use another portal
                </Button>
              </form>
            </div>
          </>
        ) : (
          <Link className="button button-primary" href="/worker/login">
            Open portal sign in
          </Link>
        )}
      </section>
    </main>
  );
}
