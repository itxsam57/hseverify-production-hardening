import { NextResponse } from "next/server";
import { CredentialIssuanceService } from "@/lib/credential/credential-issuance-service";
import { publicCredentialProjection } from "@/lib/credential/credential-issuance-domain";
import { requireRoleSession } from "@/lib/auth/auth-session-service";

export async function POST(request: Request) {
  await requireRoleSession("admin");
  const body = await request.json() as {
    workerId?: string;
    qualification?: string;
    issuedAt?: string;
    expiresAt?: string | null;
    sequence?: string;
  };

  if (!body.workerId || !body.qualification || !body.issuedAt || !body.sequence) {
    return NextResponse.json({ error: "invalid_credential_request" }, { status: 400 });
  }

  const credential = await new CredentialIssuanceService().issue({
    workerId: body.workerId,
    qualification: body.qualification,
    issuedAt: body.issuedAt,
    expiresAt: body.expiresAt ?? null
  }, body.sequence);

  return NextResponse.json(publicCredentialProjection(credential), { status: 201 });
}
