import { CredentialIssuanceRepository } from "@/lib/credential/credential-issuance-repository";

export async function GET(_request: Request, context: { params: Promise<{ credentialId: string }> }) {
  const { credentialId } = await context.params;
  const credential = await new CredentialIssuanceRepository().findPublic(credentialId);
  if (!credential) {
    return new Response("not_found_or_invalid", { status: 404 });
  }

  const body = [
    "%PDF-1.4",
    "HSE Verify Credential",
    `Credential: ${credential.credentialId}`,
    `Qualification: ${credential.qualification}`,
    `Status: ${credential.status}`
  ].join("\n");

  return new Response(body, {
    headers: { "Content-Type": "application/pdf" }
  });
}
