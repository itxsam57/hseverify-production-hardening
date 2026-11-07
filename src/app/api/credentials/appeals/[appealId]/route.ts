import { NextResponse } from "next/server";
import { CredentialAppealsRepository } from "@/lib/credential/credential-appeals-repository";
import { CredentialAppealsService } from "@/lib/credential/credential-appeals-service";
import { CredentialAppealReviewAuthorizationError, APPEAL_OUTCOME_ACTIONS, type AppealOutcomeAction } from "@/lib/credential/credential-appeals-domain";
import { requireRoleSession } from "@/lib/auth/auth-session-service";

export async function POST(request: Request, context: { params: Promise<{ appealId: string }> }) {
  const session = await requireRoleSession("admin");
  const { appealId } = await context.params;
  const body = await request.json() as {
    status?: "under_review" | "accepted" | "rejected";
    reason?: string;
    outcomeAction?: AppealOutcomeAction;
  };
  if (!body.status || !body.reason?.trim()) {
    return NextResponse.json({ error: "invalid_appeal_review_request" }, { status: 400 });
  }
  if (body.outcomeAction && !APPEAL_OUTCOME_ACTIONS.includes(body.outcomeAction)) {
    return NextResponse.json({ error: "invalid_appeal_outcome_action" }, { status: 400 });
  }

  const appeal = await new CredentialAppealsRepository().find(appealId);
  if (!appeal) return NextResponse.json({ error: "appeal_not_found" }, { status: 404 });

  try {
    const updated = await new CredentialAppealsService().reviewOutcome(appeal, {
      status: body.status,
      reviewerId: session.accountId,
      reason: body.reason,
      outcomeAction: body.outcomeAction
    });
    return NextResponse.json(updated);
  } catch (error) {
    if (error instanceof CredentialAppealReviewAuthorizationError) {
      return NextResponse.json({ error: "appeal_review_forbidden" }, { status: 403 });
    }
    throw error;
  }
}
