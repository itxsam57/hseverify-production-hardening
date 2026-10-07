import { authorizePlatformPermission } from "@/lib/authorization/authorization-context-domain";
import { readServerAuthorizationContext } from "@/lib/authorization/authorization-service";

export async function RootInvitationSearch(): Promise<React.JSX.Element | null> {
  const resolution = await readServerAuthorizationContext();
  const decision = authorizePlatformPermission({
    resolution,
    expectedRole: "root",
    permission: "platform.staff.manage"
  });
  if (!decision.allowed) return null;

  return (
    <details className="header-menu portal-search-menu" aria-label="Staff invitation search">
      <summary aria-label="Open staff invitation search">Search</summary>
      <div className="menu-panel portal-search-panel">
        <form action="/root/staff" method="get" className="portal-search-form">
          <label htmlFor="portal-invitation-query">Search staff invitations</label>
          <input
            id="portal-invitation-query"
            type="search"
            name="q"
            required
            maxLength={160}
            placeholder="Email, invitation ID, role or status"
          />
          <p>Search invitations created by your Root account.</p>
          <button className="button button-primary" type="submit">Search invitations</button>
        </form>
      </div>
    </details>
  );
}
