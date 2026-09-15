import { requirePortalAuthorization } from "@/lib/authorization/authorization-service";
import { requireWorkerSession } from "@/lib/auth/worker-session";
import { ScopedShareLinkService } from "@/lib/share-links/scoped-share-link-service";

export const dynamic = "force-dynamic";

export default async function WorkerShareLinksPage(): Promise<React.JSX.Element> {
  await requirePortalAuthorization("worker");
  const session = await requireWorkerSession();

  /*
   * The worker session is the ownership boundary used by share-link storage.
   * The authorization call above enforces the portal role before this lookup.
   */

  const links = await new ScopedShareLinkService().listOwned(session.workerId);

  return (
    <section className="profile-page" aria-labelledby="share-links-heading">
      <div className="profile-page-heading">
        <div>
          <p className="section-kicker">Digital passport sharing</p>
          <h1 id="share-links-heading">Scoped share links</h1>
          <p className="profile-page-intro">
            Create and manage controlled access links for selected passport information.
            Each link records its purpose, scope, expiry and access history.
          </p>
        </div>
      </div>

      <form className="dashboard-section" method="post" action="/api/share-links">
        <h2>Create a share link</h2>
        <input type="hidden" name="createdAt" value={new Date().toISOString()} />
        <input type="hidden" name="fields" value="worker_id,qualifications" />
        <label>
          Purpose
          <input name="purpose" required defaultValue="Credential review" />
        </label>
        <button type="submit">Create scoped link</button>
      </form>

      <section className="dashboard-section" aria-labelledby="active-share-links">
        <h2 id="active-share-links">Your links</h2>
        {links.length ? (
          <div className="table-scroll-region" role="region" aria-label="Scoped share links">
            <table>
              <thead>
                <tr><th>Purpose</th><th>Fields</th><th>Expires</th><th>Status</th></tr>
              </thead>
              <tbody>
                {links.map((link) => (
                  <tr key={link.shareLinkId}>
                    <td>{link.purpose}</td>
                    <td>{link.fields.join(", ")}</td>
                    <td>{link.expiresAt ?? "No expiry"}</td>
                    <td>{link.revokedAt ? "Revoked" : "Active"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state"><p>No scoped share links have been created.</p></div>
        )}
      </section>
    </section>
  );
}
