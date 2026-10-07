import { authorizePlatformPermission } from "@/lib/authorization/authorization-context-domain";
import { readServerAuthorizationContext } from "@/lib/authorization/authorization-service";

export async function WorkerAssessmentSearch(): Promise<React.JSX.Element | null> {
  const resolution = await readServerAuthorizationContext();
  const decision = authorizePlatformPermission({
    resolution,
    expectedRole: "worker",
    permission: "worker.assessments.read"
  });
  if (!decision.allowed) return null;

  return (
    <details className="header-menu portal-search-menu" aria-label="Assessment application search">
      <summary aria-label="Open assessment application search">Search</summary>
      <div className="menu-panel portal-search-panel">
        <form action="/worker/assessment-applications" method="get" className="portal-search-form">
          <label htmlFor="portal-assessment-query">Search assessment applications</label>
          <input
            id="portal-assessment-query"
            type="search"
            name="q"
            required
            maxLength={160}
            placeholder="Title, application ID or status"
          />
          <p>Search your assessment application history.</p>
          <button className="button button-primary" type="submit">Search applications</button>
        </form>
      </div>
    </details>
  );
}
