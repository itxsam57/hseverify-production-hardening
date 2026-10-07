import { authorizePlatformPermission } from "@/lib/authorization/authorization-context-domain";
import { readServerAuthorizationContext } from "@/lib/authorization/authorization-service";

export async function AssessorInterviewSearch(): Promise<React.JSX.Element | null> {
  const resolution = await readServerAuthorizationContext();
  const decision = authorizePlatformPermission({
    resolution,
    expectedRole: "assessor",
    permission: "interview.assigned.read"
  });
  if (!decision.allowed) return null;

  return (
    <details className="header-menu portal-search-menu" aria-label="Interview assignment search">
      <summary aria-label="Open interview assignment search">Search</summary>
      <div className="menu-panel portal-search-panel">
        <form action="/assessor/interviews" method="get" className="portal-search-form">
          <label htmlFor="portal-interview-query">Search interview assignments</label>
          <input
            id="portal-interview-query"
            type="search"
            name="q"
            required
            maxLength={160}
            placeholder="Request, case or Worker account ID, or status"
          />
          <p>Search interviews assigned to your Assessor account.</p>
          <button className="button button-primary" type="submit">Search interviews</button>
        </form>
      </div>
    </details>
  );
}
