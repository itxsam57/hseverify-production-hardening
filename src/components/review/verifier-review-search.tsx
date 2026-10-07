import { authorizePlatformPermission } from "@/lib/authorization/authorization-context-domain";
import { readServerAuthorizationContext } from "@/lib/authorization/authorization-service";

export async function VerifierReviewSearch(): Promise<React.JSX.Element | null> {
  const resolution = await readServerAuthorizationContext();
  const decision = authorizePlatformPermission({
    resolution,
    expectedRole: "verifier",
    permission: "verification.assigned.read"
  });
  if (!decision.allowed) return null;

  return (
    <details className="header-menu portal-search-menu" aria-label="Evidence review search">
      <summary aria-label="Open evidence review search">Search</summary>
      <div className="menu-panel portal-search-panel">
        <form action="/verifier/reviews" method="get" className="portal-search-form">
          <label htmlFor="portal-review-query">Search evidence reviews</label>
          <input
            id="portal-review-query"
            type="search"
            name="q"
            required
            maxLength={160}
            placeholder="Task, case, Worker account or version ID, or status"
          />
          <p>Search queued reviews and reviews assigned to your Verifier account.</p>
          <button className="button button-primary" type="submit">Search reviews</button>
        </form>
      </div>
    </details>
  );
}
