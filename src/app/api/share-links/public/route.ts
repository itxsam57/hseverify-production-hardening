import { NextResponse } from "next/server";
import { ScopedShareLinkService } from "@/lib/share-links/scoped-share-link-service";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token");
  const shareLinkId = url.searchParams.get("shareLinkId");

  if (!token || !shareLinkId) {
    return NextResponse.json({ error: "invalid_share_link_request" }, { status: 400 });
  }

  const result = await new ScopedShareLinkService().resolvePublic({
    token,
    shareLinkId,
    accessedAt: new Date().toISOString()
  });

  return NextResponse.json(result, {
    status: result.kind === "denied" ? 403 : 200
  });
}
