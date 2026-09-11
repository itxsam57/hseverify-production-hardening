export function authSessionCookieName(
  nodeEnvironment = process.env.NODE_ENV
): string {
  return nodeEnvironment === "production"
    ? "__Host-hse_session"
    : "hse_session";
}
