import { authorizeCurrentTenantPermission } from "@/lib/authorization/authorization-context-domain";
import { readServerAuthorizationContext } from "@/lib/authorization/authorization-service";

export async function CompanyWorkforceSearch(): Promise<React.JSX.Element | null> {
  const resolution = await readServerAuthorizationContext();
  const decision = authorizeCurrentTenantPermission({
    resolution,
    permission: "company.workforce.manage"
  });
  if (!decision.allowed) return null;

  return (
    <details className="header-menu portal-search-menu" aria-label="Workforce search">
      <summary aria-label="Open workforce search">Search</summary>
      <div className="menu-panel portal-search-panel">
        <form action="/company/workers" method="get" className="portal-search-form">
          <label htmlFor="portal-workforce-query">Search workforce</label>
          <input
            id="portal-workforce-query"
            type="search"
            name="q"
            required
            maxLength={160}
            placeholder="Name, email or Worker ID"
          />
          <p>Search Workers linked to your current company.</p>
          <button className="button button-primary" type="submit">Search workforce</button>
        </form>
      </div>
    </details>
  );
}
