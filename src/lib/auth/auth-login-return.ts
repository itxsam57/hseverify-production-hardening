import { ROLE_HOME_PATHS, type AuthRole } from "./auth-domain";

const WORKER_RETURN_PATHS = new Set([
  "/worker/company-access/complete-invitation",
  "/worker/company-access/complete-registration"
]);

export function safeRoleLoginReturnPath(
  role: AuthRole,
  requestedPath: string | null | undefined
): string {
  const fallback = ROLE_HOME_PATHS[role];
  if (role !== "worker" || typeof requestedPath !== "string") return fallback;
  if (!requestedPath.startsWith("/") || requestedPath.startsWith("//")) return fallback;
  if (requestedPath.includes("?") || requestedPath.includes("#") || requestedPath.includes("\\")) {
    return fallback;
  }
  return WORKER_RETURN_PATHS.has(requestedPath) ? requestedPath : fallback;
}
