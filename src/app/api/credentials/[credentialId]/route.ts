import { NextResponse } from "next/server";
import { resolvePublicCredentialRequest } from "@/lib/public-verification/public-verification-runtime";

export async function GET(_request: Request, context: { params: Promise<{ credentialId: string }> }) {
  const { credentialId } = await context.params;
  const result = await resolvePublicCredentialRequest(credentialId);
  if (result.kind !== "projection") {
    return NextResponse.json({ status: result.status }, { status: result.status === "temporarily_unavailable" ? 503 : 404 });
  }
  const credential = result.projection;
  return NextResponse.json({ credentialId: credential.publicIdentifier, status: credential.status,
    qualification: credential.competencyTitle, issuedAt: credential.issuedAt,
    expiresAt: credential.expiresAt, restrictions: credential.restrictions },
    { headers: { "Cache-Control": "no-store" } });
}
