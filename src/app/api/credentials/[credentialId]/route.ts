import { NextResponse } from "next/server";
import { CredentialIssuanceRepository } from "@/lib/credential/credential-issuance-repository";

export async function GET(_request: Request, context: { params: Promise<{ credentialId: string }> }) {
  const { credentialId } = await context.params;
  const credential = await new CredentialIssuanceRepository().findPublic(credentialId);
  if (!credential) {
    return NextResponse.json({ status: "not_found_or_invalid" }, { status: 404 });
  }
  return NextResponse.json({
    credentialId: credential.credentialId,
    status: credential.status,
    qualification: credential.qualification,
    issuedAt: credential.issuedAt,
    expiresAt: credential.expiresAt,
    version: credential.version
  });
}
