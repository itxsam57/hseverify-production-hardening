import "server-only";
import { getAuthAccessRepository } from "./auth-access-repository";
import type { AuthRole } from "./auth-domain";

export const RECENT_MFA_WINDOW_MS = 5 * 60 * 1000;
export const RECENT_MFA_ERROR = "Sign in again with MFA before overriding a decision.";

export async function requireRecentSessionMfa(
  principal: { sessionId: string; accountId: string; activeRole: AuthRole } | undefined,
  repository?: { findSessionMfaVerification(input: { sessionId: string; accountId: string; role: AuthRole; now: string }): Promise<string | null> },
  now = new Date()
): Promise<string> {
  if (!principal || principal.activeRole !== "admin") throw new Error(RECENT_MFA_ERROR);
  const verifiedAt = await (repository ?? await getAuthAccessRepository()).findSessionMfaVerification({
    sessionId: principal.sessionId, accountId: principal.accountId,
    role: principal.activeRole, now: now.toISOString()
  });
  const timestamp = verifiedAt ? Date.parse(verifiedAt) : NaN;
  if (!Number.isFinite(timestamp) || timestamp > now.getTime() || now.getTime() - timestamp > RECENT_MFA_WINDOW_MS) {
    throw new Error(RECENT_MFA_ERROR);
  }
  return verifiedAt!;
}
