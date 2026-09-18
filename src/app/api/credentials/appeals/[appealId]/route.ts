import { NextResponse } from "next/server";
import { CredentialAppealsRepository } from "@/lib/credential/credential-appeals-repository";
import { CredentialAppealsService } from "@/lib/credential/credential-appeals-service";
import { requireRoleSession } from "@/lib/auth/auth-session-service";

export async function POST(request: Request, context: { params: Promise<{ appealId: string }> }) {
  const session = await requireRoleSession("admin");
  const { appealId } = await context.params;
  const body = await request.json() as { status?: "under_review" | "accepted" | "rejected" | "withdrawn" };
  if (!body.status) return NextResponse.json({ error: "invalid_appeal_review_request" }, { status: 400 });

  const appeal = await new CredentialAppealsRepository().find(appealId);
  if (!appeal) return NextResponse.json({ error: "appeal_not_found" }, { status: 404 });

  const updated = await new CredentialAppealsService().reviewOutcome(
    appeal,
    body.status,
    session.accountId
  );
  return NextResponse.json(updated);
}
