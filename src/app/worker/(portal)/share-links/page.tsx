import { ShareLinkManager } from "@/components/worker/share-link-manager";
import { requirePortalAuthorization } from "@/lib/authorization/authorization-service";
import { requireWorkerSession } from "@/lib/auth/worker-session";
import { ScopedShareLinkService } from "@/lib/share-links/scoped-share-link-service";

export const dynamic = "force-dynamic";

export default async function WorkerShareLinksPage(): Promise<React.JSX.Element> {
  await requirePortalAuthorization("worker");
  const session = await requireWorkerSession();
  const links = await new ScopedShareLinkService().listOwned(session.workerId);

  return (
    <section className="profile-page dashboard-page" aria-labelledby="share-links-heading">
      <div className="profile-page-heading page-heading-row">
        <div>
          <p className="section-kicker">Digital passport sharing</p>
          <h1 id="share-links-heading">Scoped share links</h1>
          <p className="profile-page-intro page-intro">
            Share only selected passport information through time-limited, revocable links.
            Your full profile and private evidence remain hidden.
          </p>
        </div>
      </div>
      <ShareLinkManager links={links} />
    </section>
  );
}
