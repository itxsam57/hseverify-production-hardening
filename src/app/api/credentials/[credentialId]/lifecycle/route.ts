import { NextResponse } from "next/server";
import { CredentialLifecycleService } from "@/lib/credential/credential-lifecycle-service";
import { requireRoleSession } from "@/lib/auth/auth-session-service";

export async function POST(request: Request, context: { params: Promise<{ credentialId: string }> }) {
  await requireRoleSession("admin");
  const { credentialId } = await context.params;
  const body = await request.json() as { action?: "renew" | "suspend" | "revoke"; currentStatus?: "valid" | "expired" | "suspended" | "revoked"; version?: number };
  if (!body.action || !body.currentStatus || typeof body.version !== "number") {
    return NextResponse.json({ error: "invalid_lifecycle_request" }, { status: 400 });
  }

  const credential = await new CredentialLifecycleService().changeStatus({
    credentialId,
    action: body.action,
    currentStatus: body.currentStatus,
    version: body.version
  });
  return NextResponse.json(credential);
}
