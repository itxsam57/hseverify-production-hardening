import { CredentialIssuanceRepository } from "@/lib/credential/credential-issuance-repository";

export async function GET(_request: Request, context: { params: Promise<{ credentialId: string }> }) {
  const { credentialId } = await context.params;
  const credential = await new CredentialIssuanceRepository().findPublic(credentialId);
  if (!credential) {
    return new Response("not_found_or_invalid", { status: 404 });
  }

  const escapePdf = (value: string) => value.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
  const text = [
    "HSE Verify Credential",
    `Credential: ${credential.credentialId}`,
    `Qualification: ${credential.qualification}`,
    `Status: ${credential.status}`,
    `Verification: ${credential.publicStatusUrl}`
  ].map(escapePdf);

  const stream = ["BT", "/F1 12 Tf", "50 750 Td", ...text.flatMap((line, index) => [index ? "0 -18 Td" : "", `(${line}) Tj`]), "ET"].filter(Boolean).join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`
  ];
  let body = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets[index + 1] = body.length;
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;

  return new Response(body, {
    headers: { "Content-Type": "application/pdf" }
  });
}
