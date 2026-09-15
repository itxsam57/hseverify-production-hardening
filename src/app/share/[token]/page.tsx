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
      {result.projection.qualifications && (
        <ul aria-label="Shared qualifications">
          {result.projection.qualifications.map((item) => <li key={item.recordId}>{item.title}</li>)}
        </ul>
      )}
    </main>
  );
}
