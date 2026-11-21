import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { CredentialAppealsService } from "@/lib/credential/credential-appeals-service";
import { requireWorkerSession } from "@/lib/auth/worker-session";
import { requirePortalAuthorization } from "@/lib/authorization/authorization-service";
import { CredentialIssuanceRepository } from "@/lib/credential/credential-issuance-repository";
import { WorkerEvidenceService } from "@/lib/worker-evidence/worker-evidence-service";
import { getDatabaseClient } from "@/lib/database/database";

const errorResponse = (status: number, code: string) =>
  NextResponse.json({ error: code }, { status });

export async function POST(request: Request, context: { params: Promise<{ credentialId: string }> }) {
  const [principal, session] = await Promise.all([
    requirePortalAuthorization("worker"),
    requireWorkerSession()
  ]);
  const { credentialId } = await context.params;
  const parsed: unknown = await request.json().catch(() => null);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return errorResponse(400, "invalid_appeal_request");
  }

  const body = parsed as Record<string, unknown>;
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (reason.length < 10 || reason.length > 4000) {
    return errorResponse(400, "invalid_appeal_request");
  }
  if (body.workerId !== undefined && typeof body.workerId !== "string") {
    return errorResponse(400, "invalid_appeal_request");
  }
  if (body.workerId && body.workerId !== session.workerId) {
    return errorResponse(403, "credential_appeal_forbidden");
  }

  const evidenceInput = body.evidence === undefined ? [] : body.evidence;
  if (
    !Array.isArray(evidenceInput) ||
    evidenceInput.length > 20 ||
    evidenceInput.some((item: unknown) => typeof item !== "string" || !item.trim() || item.length > 128)
  ) {
    return errorResponse(400, "invalid_appeal_evidence");
  }
  const evidence = (evidenceInput as string[]).map((item) => item.trim());
  if (new Set(evidence).size !== evidence.length) {
    return errorResponse(400, "invalid_appeal_evidence");
  }

  const sequence = typeof body.sequence === "string" ? body.sequence.trim() : "";
  if (
    (body.sequence !== undefined && typeof body.sequence !== "string") ||
    (sequence.length > 0 && !/^[a-zA-Z0-9_-]{1,64}$/.test(sequence))
  ) {
    return errorResponse(400, "invalid_appeal_request");
  }

  const credential = await new CredentialIssuanceRepository().findPublic(credentialId);
  if (!credential || credential.workerId !== session.workerId) {
    return errorResponse(403, "credential_appeal_forbidden");
  }

  if (evidence.length) {
    // The Worker form already enforces this boundary. The direct HTTP route must
    // independently validate every reference rather than trust caller-supplied IDs.
    const records = await new WorkerEvidenceService(getDatabaseClient()).listCurrent(principal);
    const owned = new Set(records.map((record) => record.recordId));
    if (evidence.some((recordId) => !owned.has(recordId))) {
      return errorResponse(403, "credential_appeal_evidence_forbidden");
    }
  }

  try {
    const appeal = await new CredentialAppealsService().submit({
      credentialId,
      workerId: session.workerId,
      reason,
      evidence,
      createdAt: new Date().toISOString()
    }, sequence || randomBytes(12).toString("hex"));
    return NextResponse.json(appeal, {
      status: 201,
      headers: { "Cache-Control": "private, no-store, max-age=0" }
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes("already open")) {
      return errorResponse(409, "credential_appeal_already_open");
    }
    throw error;
  }
}
