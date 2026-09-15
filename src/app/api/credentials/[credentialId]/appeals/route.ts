import { NextResponse } from "next/server";
import { CredentialAppealsService } from "@/lib/credential/credential-appeals-service";
import { requireWorkerSession } from "@/lib/auth/worker-session";
import { CredentialIssuanceRepository } from "@/lib/credential/credential-issuance-repository";

export async function POST(request: Request, context: { params: Promise<{ credentialId: string }> }) {
  const session = await requireWorkerSession();
  const { credentialId } = await context.params;
  const body = await request.json() as { workerId?: string; reason?: string; evidence?: string[]; sequence?: string };
  if (!body.reason || !body.sequence) {
    return NextResponse.json({ error: "invalid_appeal_request" }, { status: 400 });
  }
  if (body.workerId && body.workerId !== session.workerId) {
    return NextResponse.json({ error: "credential_appeal_forbidden" }, { status: 403 });
  }
  const credential = await new CredentialIssuanceRepository().findPublic(credentialId);
  if (!credential || credential.workerId !== session.workerId) {
    return NextResponse.json({ error: "credential_appeal_forbidden" }, { status: 403 });
  }
  const appeal = await new CredentialAppealsService().submit({
    credentialId,
    workerId: session.workerId,
    reason: body.reason,
    evidence: body.evidence,
    createdAt: new Date().toISOString()
  }, body.sequence);
  return NextResponse.json(appeal, { status: 201 });
}
