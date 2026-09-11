import "server-only";

import type { AuthRole } from "../auth/auth-domain";
import type { AuthorizationPrincipal } from "../authorization/authorization-context-domain";
import {
  requireCurrentTenantPermission,
  requirePlatformPermission
} from "../authorization/authorization-service";
import {
  bindPlatformAuditReadPrincipal,
  bindTrustedAuditActor,
  type AuditEventRecord
} from "./audit-domain";
import {
  getAuditRepository,
  type AppendAuditEventInput,
  type AuditQueryOptions,
  type AuditRepository
} from "./audit-repository";

export async function recordPlatformAuditEvent(input: {
  principal: AuthorizationPrincipal;
  event: AppendAuditEventInput;
  repository?: AuditRepository;
}): Promise<AuditEventRecord> {
  const actor = bindTrustedAuditActor(input.principal);
  return (input.repository ?? getAuditRepository()).append(actor, input.event);
}

export async function listAuthorizedPlatformAuditEvents(input: {
  expectedRole: Extract<AuthRole, "admin" | "root">;
  options?: AuditQueryOptions;
  repository?: AuditRepository;
}): Promise<readonly AuditEventRecord[]> {
  const principal = await requirePlatformPermission({
    expectedRole: input.expectedRole,
    permission: "platform.security.read"
  });
  return (input.repository ?? getAuditRepository()).listPlatform(
    bindPlatformAuditReadPrincipal(principal),
    input.options
  );
}

export async function findAuthorizedPlatformAuditEvent(input: {
  expectedRole: Extract<AuthRole, "admin" | "root">;
  auditEventId: string;
  repository?: AuditRepository;
}): Promise<AuditEventRecord | null> {
  const principal = await requirePlatformPermission({
    expectedRole: input.expectedRole,
    permission: "platform.security.read"
  });
  return (input.repository ?? getAuditRepository()).findPlatformById(
    bindPlatformAuditReadPrincipal(principal),
    input.auditEventId
  );
}

export async function listCurrentTenantAuditEvents(input?: {
  options?: AuditQueryOptions;
  repository?: AuditRepository;
}): Promise<readonly AuditEventRecord[]> {
  const principal = await requireCurrentTenantPermission("company.audit.read");
  return (input?.repository ?? getAuditRepository()).listTenant(
    principal,
    input?.options
  );
}

export async function findCurrentTenantAuditEvent(input: {
  auditEventId: string;
  repository?: AuditRepository;
}): Promise<AuditEventRecord | null> {
  const principal = await requireCurrentTenantPermission("company.audit.read");
  return (input.repository ?? getAuditRepository()).findTenantById(
    principal,
    input.auditEventId
  );
}
