import "server-only";

import type { DatabaseClient } from "../database/database";
import { getDatabaseClient } from "../database/database";
import { runTenantScopedCommand } from "../authorization/tenant-scoped-command-guard";
import type { TenantPermissionPrincipal } from "../authorization/tenant-scoped-resource-domain";
import {
  AuditContractError,
  AuditReadDeniedError,
  assertTenantAuditReadPrincipal,
  assertTrustedAuditActor,
  createAuditEventId,
  derivePlatformAuditReadScope,
  isAuditAction,
  isAuditOutcome,
  isAuditTargetType,
  normalizeAuditCursor,
  normalizeAuditLimit,
  normalizeAuditMetadata,
  normalizeAuditReason,
  normalizeAuditTarget,
  type AuditAction,
  type AuditEventRecord,
  type AuditOutcome,
  type AuditTarget,
  type PlatformAuditReadPrincipal,
  type TrustedAuditActor
} from "./audit-domain";

export const AUDIT_APPEND_SQL = `
INSERT INTO platform_audit_events (
  audit_event_id, source_kind, source_event_id,
  actor_account_id, actor_role, actor_tenant_id, actor_membership_id,
  action_key, outcome, reason_key, target_type, target_reference,
  request_fingerprint_hash, metadata, occurred_at, recorded_at
) VALUES (
  $1, 'native', NULL,
  $2, $3, $4, $5,
  $6, $7, $8, $9, $10,
  $11, $12::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
)
RETURNING audit_sequence, audit_event_id, source_kind, source_event_id,
          actor_account_id, actor_role, actor_tenant_id, actor_membership_id,
          action_key, outcome, reason_key, target_type, target_reference,
          request_fingerprint_hash, metadata, occurred_at, recorded_at`;

export const AUDIT_PLATFORM_READ_GUARD_SQL = `
SELECT sessions.session_id
FROM auth_sessions AS sessions
JOIN auth_accounts AS accounts
  ON accounts.account_id = sessions.account_id
JOIN auth_account_roles AS roles
  ON roles.account_id = sessions.account_id
 AND roles.role = sessions.active_role
WHERE sessions.session_id = $1
  AND sessions.account_id = $2
  AND sessions.active_role = $3
  AND sessions.active_role IN ('admin', 'root')
  AND accounts.account_status = 'active'
  AND sessions.revoked_at IS NULL
  AND sessions.expires_at > $4::timestamptz
FOR UPDATE OF sessions, accounts`;

export const AUDIT_PLATFORM_LIST_SQL = `
SELECT audit_sequence, audit_event_id, source_kind, source_event_id,
       actor_account_id, actor_role, actor_tenant_id, actor_membership_id,
       action_key, outcome, reason_key, target_type, target_reference,
       request_fingerprint_hash, metadata, occurred_at, recorded_at
FROM platform_audit_events
WHERE ($1::bigint IS NULL OR audit_sequence < $1::bigint)
ORDER BY audit_sequence DESC
LIMIT $2`;

export const AUDIT_PLATFORM_FIND_SQL = `
SELECT audit_sequence, audit_event_id, source_kind, source_event_id,
       actor_account_id, actor_role, actor_tenant_id, actor_membership_id,
       action_key, outcome, reason_key, target_type, target_reference,
       request_fingerprint_hash, metadata, occurred_at, recorded_at
FROM platform_audit_events
WHERE audit_event_id = $1`;

export const AUDIT_TENANT_LIST_SQL = `
SELECT audit_sequence, audit_event_id, source_kind, source_event_id,
       actor_account_id, actor_role, actor_tenant_id, actor_membership_id,
       action_key, outcome, reason_key, target_type, target_reference,
       request_fingerprint_hash, metadata, occurred_at, recorded_at
FROM platform_audit_events
WHERE actor_tenant_id = $1
  AND ($2::bigint IS NULL OR audit_sequence < $2::bigint)
ORDER BY audit_sequence DESC
LIMIT $3`;

export const AUDIT_TENANT_FIND_SQL = `
SELECT audit_sequence, audit_event_id, source_kind, source_event_id,
       actor_account_id, actor_role, actor_tenant_id, actor_membership_id,
       action_key, outcome, reason_key, target_type, target_reference,
       request_fingerprint_hash, metadata, occurred_at, recorded_at
FROM platform_audit_events
WHERE actor_tenant_id = $1
  AND audit_event_id = $2`;

type AuditRow = {
  audit_sequence: number | string;
  audit_event_id: string;
  source_kind: "native" | "auth_security_event";
  source_event_id: string | null;
  actor_account_id: string | null;
  actor_role: string | null;
  actor_tenant_id: string | null;
  actor_membership_id: string | null;
  action_key: string;
  outcome: string;
  reason_key: string | null;
  target_type: string;
  target_reference: string | null;
  request_fingerprint_hash: string | null;
  metadata: unknown;
  occurred_at: string | Date;
  recorded_at: string | Date;
};

function timestamp(value: string | Date): string {
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}

function fromRow(row: AuditRow): AuditEventRecord {
  if (
    !isAuditAction(row.action_key) ||
    !isAuditOutcome(row.outcome) ||
    !isAuditTargetType(row.target_type)
  ) {
    throw new AuditContractError("Stored audit event vocabulary is invalid.");
  }
  const metadata =
    typeof row.metadata === "string"
      ? JSON.parse(row.metadata) as unknown
      : row.metadata;

  return Object.freeze({
    sequence: Number(row.audit_sequence),
    auditEventId: row.audit_event_id,
    sourceKind: row.source_kind,
    sourceEventId: row.source_event_id,
    actorAccountId: row.actor_account_id,
    actorRole: row.actor_role as AuditEventRecord["actorRole"],
    actorTenantId: row.actor_tenant_id,
    actorMembershipId: row.actor_membership_id,
    action: row.action_key,
    outcome: row.outcome,
    reason: row.reason_key,
    target: normalizeAuditTarget({
      type: row.target_type,
      reference: row.target_reference
    }),
    requestFingerprintHash: row.request_fingerprint_hash,
    metadata: normalizeAuditMetadata(metadata),
    occurredAt: timestamp(row.occurred_at),
    recordedAt: timestamp(row.recorded_at)
  });
}

export type AppendAuditEventInput = Readonly<{
  action: AuditAction;
  outcome: AuditOutcome;
  reason?: string | null;
  target: AuditTarget;
  requestFingerprintHash?: string | null;
  metadata?: unknown;
}>;

export type AuditQueryOptions = Readonly<{
  beforeSequence?: number | null;
  limit?: number;
}>;

export interface AuditRepository {
  append(
    actor: TrustedAuditActor,
    input: AppendAuditEventInput
  ): Promise<AuditEventRecord>;
  listPlatform(
    principal: PlatformAuditReadPrincipal,
    options?: AuditQueryOptions
  ): Promise<readonly AuditEventRecord[]>;
  findPlatformById(
    principal: PlatformAuditReadPrincipal,
    auditEventId: string
  ): Promise<AuditEventRecord | null>;
  listTenant(
    principal: TenantPermissionPrincipal<"company.audit.read">,
    options?: AuditQueryOptions
  ): Promise<readonly AuditEventRecord[]>;
  findTenantById(
    principal: TenantPermissionPrincipal<"company.audit.read">,
    auditEventId: string
  ): Promise<AuditEventRecord | null>;
}

export class DatabaseAuditRepository implements AuditRepository {
  constructor(
    private readonly clientPromise: Promise<DatabaseClient> = getDatabaseClient()
  ) {}

  private client(): Promise<DatabaseClient> {
    return this.clientPromise;
  }

  async append(
    actorInput: TrustedAuditActor,
    input: AppendAuditEventInput
  ): Promise<AuditEventRecord> {
    const actor = assertTrustedAuditActor(actorInput);
    if (!isAuditAction(input.action) || !isAuditOutcome(input.outcome)) {
      throw new AuditContractError("Unknown audit action or outcome.");
    }
    const reason = normalizeAuditReason(input.reason);
    const target = normalizeAuditTarget(input.target);
    const metadata = normalizeAuditMetadata(input.metadata);
    const fingerprint = input.requestFingerprintHash?.trim() || null;
    if (fingerprint && fingerprint.length > 256) {
      throw new AuditContractError("Request fingerprint hash is invalid.");
    }

    const database = await this.client();
    const result = await database.query<AuditRow>(AUDIT_APPEND_SQL, [
      createAuditEventId(),
      actor.accountId,
      actor.activeRole,
      actor.tenantId,
      actor.membershipId,
      input.action,
      input.outcome,
      reason,
      target.type,
      target.reference,
      fingerprint,
      JSON.stringify(metadata)
    ]);
    const row = result.rows[0];
    if (!row) throw new AuditContractError("Audit event was not persisted.");
    return fromRow(row);
  }

  async listPlatform(
    principal: PlatformAuditReadPrincipal,
    options: AuditQueryOptions = {}
  ): Promise<readonly AuditEventRecord[]> {
    const scope = derivePlatformAuditReadScope(principal);
    const cursor = normalizeAuditCursor(options.beforeSequence);
    const limit = normalizeAuditLimit(options.limit);
    const database = await this.client();

    return database.transaction(async (transaction) => {
      const guard = await transaction.query<{ session_id: string }>(
        AUDIT_PLATFORM_READ_GUARD_SQL,
        [
          scope.sessionId,
          scope.accountId,
          scope.activeRole,
          new Date().toISOString()
        ]
      );
      if (guard.rows[0]?.session_id !== scope.sessionId) {
        throw new AuditReadDeniedError();
      }
      const result = await transaction.query<AuditRow>(
        AUDIT_PLATFORM_LIST_SQL,
        [cursor, limit]
      );
      return Object.freeze(result.rows.map(fromRow));
    });
  }

  async findPlatformById(
    principal: PlatformAuditReadPrincipal,
    auditEventId: string
  ): Promise<AuditEventRecord | null> {
    const scope = derivePlatformAuditReadScope(principal);
    const database = await this.client();

    return database.transaction(async (transaction) => {
      const guard = await transaction.query<{ session_id: string }>(
        AUDIT_PLATFORM_READ_GUARD_SQL,
        [
          scope.sessionId,
          scope.accountId,
          scope.activeRole,
          new Date().toISOString()
        ]
      );
      if (guard.rows[0]?.session_id !== scope.sessionId) {
        throw new AuditReadDeniedError();
      }
      const result = await transaction.query<AuditRow>(
        AUDIT_PLATFORM_FIND_SQL,
        [auditEventId]
      );
      return result.rows[0] ? fromRow(result.rows[0]) : null;
    });
  }

  async listTenant(
    principal: TenantPermissionPrincipal<"company.audit.read">,
    options: AuditQueryOptions = {}
  ): Promise<readonly AuditEventRecord[]> {
    assertTenantAuditReadPrincipal(principal);
    const cursor = normalizeAuditCursor(options.beforeSequence);
    const limit = normalizeAuditLimit(options.limit);
    return runTenantScopedCommand({
      database: await this.client(),
      principal,
      permission: "company.audit.read",
      operation: async ({ database, scope }) => {
        const result = await database.query<AuditRow>(AUDIT_TENANT_LIST_SQL, [
          scope.tenantId,
          cursor,
          limit
        ]);
        return Object.freeze(result.rows.map(fromRow));
      }
    });
  }

  async findTenantById(
    principal: TenantPermissionPrincipal<"company.audit.read">,
    auditEventId: string
  ): Promise<AuditEventRecord | null> {
    assertTenantAuditReadPrincipal(principal);
    return runTenantScopedCommand({
      database: await this.client(),
      principal,
      permission: "company.audit.read",
      operation: async ({ database, scope }) => {
        const result = await database.query<AuditRow>(AUDIT_TENANT_FIND_SQL, [
          scope.tenantId,
          auditEventId
        ]);
        return result.rows[0] ? fromRow(result.rows[0]) : null;
      }
    });
  }
}

let repository: AuditRepository | null = null;

export function getAuditRepository(): AuditRepository {
  repository ??= new DatabaseAuditRepository();
  return repository;
}
