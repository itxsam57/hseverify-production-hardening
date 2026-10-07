import { authorizePlatformPermission } from "@/lib/authorization/authorization-context-domain";
import { readServerAuthorizationContext } from "@/lib/authorization/authorization-service";

export async function AdminVerificationSearch(): Promise<React.JSX.Element | null> {
  const resolution = await readServerAuthorizationContext();
  const decision = authorizePlatformPermission({
    resolution,
    expectedRole: "admin",
    permission: "platform.tenants.manage"
  });
  if (!decision.allowed) return null;

  return (
    <details className="header-menu portal-search-menu" aria-label="Company verification search">
      <summary aria-label="Open Company verification search">Search</summary>
      <div className="menu-panel portal-search-panel">
        <form action="/admin/company-verifications" method="get" className="portal-search-form">
          <label htmlFor="portal-verification-query">Search Company verifications</label>
          <input
            id="portal-verification-query"
            type="search"
            name="q"
            required
            maxLength={160}
            placeholder="Company name, registration, email, case ID or status"
          />
          <p>Search submitted Company verifications awaiting an Administrator review.</p>
          <button className="button button-primary" type="submit">Search verifications</button>
        </form>
      </div>
    </details>
  );
}
