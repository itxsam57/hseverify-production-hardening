"use server";

import { redirect } from "next/navigation";

import { ROLE_LOGIN_PATHS } from "@/lib/auth/auth-domain";
import { clearAuthSessionToken } from "@/lib/auth/auth-session-cookie";
import {
  requireAuthenticatedSession,
  revokeOwnSession
} from "@/lib/auth/auth-session-service";

export async function revokeAccountSession(formData: FormData): Promise<void> {
  const session = await requireAuthenticatedSession();
  const value = formData.get("sessionId");
  const targetSessionId = typeof value === "string" ? value : "";
  if (!targetSessionId) return;

  const revoked = await revokeOwnSession({ session, targetSessionId });
  if (revoked && targetSessionId === session.sessionId) {
    await clearAuthSessionToken();
    redirect(`${ROLE_LOGIN_PATHS[session.role]}?reason=signed-out`);
  }
  redirect("/account/sessions");
}
