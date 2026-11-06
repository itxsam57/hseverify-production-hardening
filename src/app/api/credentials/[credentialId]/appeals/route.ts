import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { CredentialAppealsService } from "@/lib/credential/credential-appeals-service";
import { requireWorkerSession } from "@/lib/auth/worker-session";
import { requirePortalAuthorization } from "@/lib/authorization/authorization-service";
import { CredentialIssuanceRepository } from "@/lib/credential/credential-issuance-repository";
import { getDatabaseClient } from "@/lib/database/database";
import { WorkerEvidenceService } from "@/lib/worker-evidence/worker-evidence-service";

export async function POST(request: Request, context: { params: Promise<{ credentialId: string }> }) {
  const session = await requireWorkerSession();
  const { credentialId } = await context.params;
  const body: { workerId?: unknown; reason?: unknown; evidence?: unknown; sequence?: unknown } | null =
    await request.json().catch(() => null);
  if (typeof body?.reason !== "string" || !body.reason.trim() ||
      (body.sequence !== undefined && typeof body.sequence !== "string")) {
    return NextResponse.json({ error: "invalid_appeal_request" }, { status: 400 });
  }
  if (body.workerId && body.workerId !== session.workerId) {
    return NextResponse.json({ error: "credential_appeal_forbidden" }, { status: 403 });
  }
  const credential = await new CredentialIssuanceRepository().findPublic(credentialId);
  if (!credential || credential.workerId !== session.workerId) {
    return NextResponse.json({ error: "credential_appeal_forbidden" }, { status: 403 });
  }
  const invalidEvidence = () => NextResponse.json({ error: "invalid_appeal_evidence" }, { status: 400 });
  const supplied = body.evidence ?? [];
  if (!Array.isArray(supplied) || supplied.some(value => typeof value !== "string")) {
    return invalidEvidence();
  }
  const evidence = supplied.map(value => value.trim()).filter(Boolean);
  if (evidence.length) {
    const principal = await requirePortalAuthorization("worker");
    const current = await new WorkerEvidenceService(getDatabaseClient()).listCurrent(principal);
    const owned = new Set(current.map(record => record.recordId));
    if (evidence.some(recordId => !owned.has(recordId))) return invalidEvidence();
  }
  const appeal = await new CredentialAppealsService().submit({
    credentialId,
    workerId: session.workerId,
    reason: body.reason,
    evidence,
    createdAt: new Date().toISOString()
  }, body.sequence?.trim() || randomBytes(12).toString("hex"));
  return NextResponse.json(appeal, { status: 201 });
}
