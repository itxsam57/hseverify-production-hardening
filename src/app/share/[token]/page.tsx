import { ScopedShareLinkService } from "@/lib/share-links/scoped-share-link-service";

export const dynamic = "force-dynamic";

export default async function SharedPassportPage({
  params,
  searchParams
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ shareLinkId?: string }>;
}): Promise<React.JSX.Element> {
  const { token } = await params;
  const { shareLinkId } = await searchParams;

  if (!shareLinkId) {
    return <main><h1>Share link unavailable</h1></main>;
  }

  const result = await new ScopedShareLinkService().resolvePublic({
    token,
    shareLinkId,
    accessedAt: new Date().toISOString()
  });

  if (result.kind === "denied") {
    return <main><h1>Share link unavailable</h1><p>{result.reason}</p></main>;
  }

  return (
    <main aria-label="Shared digital passport">
      <h1>Shared digital passport</h1>
      <p>Purpose: {result.projection.purpose}</p>
      {result.projection.workerId && <p>Worker ID: {result.projection.workerId}</p>}
      {result.projection.employerDetail && <p>Recipient or employer: {result.projection.employerDetail}</p>}
      {result.projection.qualifications && (
        <ul aria-label="Shared qualifications">
          {result.projection.qualifications.map((item) => <li key={item.recordId}>{item.title}</li>)}
        </ul>
      )}
      {result.projection.skills && <ul aria-label="Shared skills">
        {result.projection.skills.map((item) => <li key={item.recordId}>{item.name} · {item.assuranceStatus.replaceAll("_", " ")}</li>)}
      </ul>}
      {result.projection.competencies && <ul aria-label="Shared competencies">
        {result.projection.competencies.map((item) => <li key={item.competencyId}><strong>{item.title}</strong><p>{item.status.replaceAll("_", " ")} · {item.expiresAt ? `expires ${item.expiresAt}` : "no expiry recorded"}</p></li>)}
      </ul>}
      {result.projection.restrictions && <p>Restrictions: {result.projection.restrictions.join(", ") || "None recorded"}</p>}
      {result.projection.conditions && <p>Conditions: {result.projection.conditions.join(", ") || "None recorded"}</p>}
      {result.projection.nextExpiryAt !== undefined && <p>Next expiry: {result.projection.nextExpiryAt ?? "None recorded"}</p>}
    </main>
  );
}
