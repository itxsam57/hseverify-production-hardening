import "server-only";

import type { AuthorizationPrincipal } from "../authorization/authorization-context-domain";
import type { DatabaseClient } from "../database/database";
import { getDatabaseClient } from "../database/database";
import {
  NOTIFICATION_SCHEMA_VERSION,
  NotificationAccessDeniedError,
  NotificationContractError,
  createNotificationId,
  deriveNotificationProjectionKey,
  isNotificationRole,
  isNotificationTarget,
  isNotificationType,
  normalizeNotificationCursor,
  normalizeNotificationId,
  normalizeNotificationLimit,
  normalizeNotificationMetadata,
  notificationContent,
  type NotificationQueryOptions,
  type NotificationRecord
} from "./notification-domain";
import {
  assertNotificationProjectionJob,
  type FoundationNotificationMetadata
} from "./notification-domain";
import type { OutboxJobRecord } from "../outbox/outbox-domain";

export const NOTIFICATION_INSERT_SQL = `
INSERT INTO platform_notifications (
  notification_id, notification_type, schema_version,
  source_job_id, projection_key,
  recipient_account_id, recipient_role, tenant_id, membership_id,
  title, body, metadata, target_key, target_reference
)
SELECT
  $1, $2, $3,
  $4, $5,
  $6, $7, $8, $9,
  $10, $11, $12::jsonb, $13, $14
FROM auth_accounts AS accounts
JOIN auth_account_roles AS roles
  ON roles.account_id = accounts.account_id
 AND roles.role = $7
WHERE accounts.account_id = $6
  AND accounts.account_status = 'active'
  AND (
    (
      $7 <> 'company'
      AND $8::text IS NULL
      AND $9::text IS NULL
    ) OR (
      $7 = 'company'
      AND EXISTS (
        SELECT 1
        FROM auth_tenant_memberships AS memberships
        JOIN platform_tenants AS tenants
          ON tenants.tenant_id = memberships.tenant_id
        WHERE memberships.membership_id = $9
          AND memberships.tenant_id = $8
          AND memberships.account_id = $6
          AND memberships.portal_role = 'company'
          AND memberships.membership_status = 'active'
          AND tenants.tenant_status = 'active'
      )
    )
  )
ON CONFLICT (projection_key) DO NOTHING
RETURNING *`;

export const NOTIFICATION_FIND_PROJECTION_SQL = `
SELECT *
FROM platform_notifications
WHERE projection_key = $1`;

export const NOTIFICATION_SESSION_GUARD_SQL = `
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
  AND accounts.account_status = 'active'
  AND sessions.revoked_at IS NULL
  AND sessions.expires_at > CURRENT_TIMESTAMP
FOR UPDATE OF sessions, accounts`;

export const NOTIFICATION_COMPANY_SCOPE_GUARD_SQL = `
SELECT memberships.membership_id
FROM auth_tenant_memberships AS memberships
JOIN platform_tenants AS tenants
  ON tenants.tenant_id = memberships.tenant_id
WHERE memberships.membership_id = $1
  AND memberships.tenant_id = $2
  AND memberships.account_id = $3
  AND memberships.portal_role = 'company'
  AND memberships.membership_status = 'active'
  AND tenants.tenant_status IN ('pending', 'active')
FOR UPDATE OF memberships, tenants`;

export const NOTIFICATION_LIST_SQL = `
SELECT *
FROM platform_notifications
WHERE recipient_account_id = $1
  AND recipient_role = $2
  AND (
    (
      $2 = 'company'
      AND tenant_id = $3
      AND membership_id = $4
    ) OR (
      $2 <> 'company'
      AND tenant_id IS NULL
      AND membership_id IS NULL
    )
  )
  AND ($5::bigint IS NULL OR notification_sequence < $5::bigint)
ORDER BY notification_sequence DESC
LIMIT $6`;

export const NOTIFICATION_UNREAD_COUNT_SQL = `
SELECT COUNT(*)::bigint AS unread_count
FROM platform_notifications
WHERE recipient_account_id = $1
  AND recipient_role = $2
  AND read_at IS NULL
  AND (
    (
      $2 = 'company'
      AND tenant_id = $3
      AND membership_id = $4
    ) OR (
      $2 <> 'company'
      AND tenant_id IS NULL
      AND membership_id IS NULL
    )
  )`;

export const NOTIFICATION_FIND_SQL = `
SELECT *
FROM platform_notifications
WHERE notification_id = $1
  AND recipient_account_id = $2
  AND recipient_role = $3
  AND (
    (
      $3 = 'company'
      AND tenant_id = $4
      AND membership_id = $5
    ) OR (
      $3 <> 'company'
      AND tenant_id IS NULL
      AND membership_id IS NULL
    )
  )`;

export const NOTIFICATION_MARK_READ_SQL = `
UPDATE platform_notifications
SET read_at = CURRENT_TIMESTAMP,
    updated_at = CURRENT_TIMESTAMP
WHERE notification_id = $1
  AND recipient_account_id = $2
  AND recipient_role = $3
  AND read_at IS NULL
  AND (
    (
      $3 = 'company'
      AND tenant_id = $4
      AND membership_id = $5
    ) OR (
      $3 <> 'company'
      AND tenant_id IS NULL
      AND membership_id IS NULL
    )
  )
RETURNING *`;

type NotificationRow = {
  notification_sequence: number | string;
  notification_id: string;
  notification_type: string;
  schema_version: number | string;
  source_job_id: string;
  projection_key: string;
  recipient_account_id: string;
  recipient_role: string;
  tenant_id: string | null;
  membership_id: string | null;
  title: string;
  body: string;
  metadata: unknown;
  target_key: string;
  target_reference: string | null;
  read_at: string | Date | null;
  created_at: string | Date;
  updated_at: string | Date;
};

function timestamp(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function optionalTimestamp(value: string | Date | null): string | null {
  return value === null ? null : timestamp(value);
}

function parseMetadata(value: unknown): unknown {
  return typeof value === "string" ? JSON.parse(value) as unknown : value;
}

function notificationFromRow(row: NotificationRow): NotificationRecord {
  if (
    !isNotificationType(row.notification_type) ||
    !isNotificationRole(row.recipient_role) ||
    !isNotificationTarget(row.target_key) ||
    Number(row.schema_version) !== NOTIFICATION_SCHEMA_VERSION
  ) {
    throw new NotificationContractError(
      "Stored notification vocabulary is invalid."
    );
  }
  const metadata = normalizeNotificationMetadata(
    row.notification_type,
    parseMetadata(row.metadata)
  );
  const content = notificationContent(row.notification_type);
  if (
    row.title !== content.title ||
    row.body !== content.body ||
    row.target_key !== content.target ||
    row.target_reference !== content.targetReference
  ) {
    throw new NotificationContractError(
      "Stored notification content does not match its fixed type."
    );
  }
  return Object.freeze({
    sequence: Number(row.notification_sequence),
    notificationId: row.notification_id,
    notificationType: row.notification_type,
    schemaVersion: NOTIFICATION_SCHEMA_VERSION,
    sourceJobId: row.source_job_id,
    projectionKey: row.projection_key,
    recipientAccountId: row.recipient_account_id,
    recipientRole: row.recipient_role,
    tenantId: row.tenant_id,
    membershipId: row.membership_id,
    title: row.title,
    body: row.body,
    metadata,
    target: row.target_key,
    targetReference: row.target_reference,
    readAt: optionalTimestamp(row.read_at),
    createdAt: timestamp(row.created_at),
    updatedAt: timestamp(row.updated_at)
  });
}

async function assertLivePrincipal(
  database: DatabaseClient,
  principal: AuthorizationPrincipal
): Promise<void> {
  const session = await database.query<{ session_id: string }>(
    NOTIFICATION_SESSION_GUARD_SQL,
    [principal.sessionId, principal.accountId, principal.activeRole]
  );
  if (session.rows[0]?.session_id !== principal.sessionId) {
    throw new NotificationAccessDeniedError();
  }

  if (principal.activeRole === "company") {
    const membership = principal.tenantMembership;
    if (!membership) throw new NotificationAccessDeniedError();
    const scope = await database.query<{ membership_id: string }>(
      NOTIFICATION_COMPANY_SCOPE_GUARD_SQL,
      [membership.membershipId, membership.tenantId, principal.accountId]
    );
    if (scope.rows[0]?.membership_id !== membership.membershipId) {
      throw new NotificationAccessDeniedError();
    }
  } else if (principal.tenantMembership !== null) {
    throw new NotificationAccessDeniedError();
  }
}

function scopeParameters(
  principal: AuthorizationPrincipal
): readonly [string, string, string | null, string | null] {
  const membership = principal.tenantMembership;
  return [
    principal.accountId,
    principal.activeRole,
    membership?.tenantId ?? null,
    membership?.membershipId ?? null
  ];
}

export type NotificationProjectionResult =
  | Readonly<{ kind: "projected"; created: boolean; notification: NotificationRecord }>
  | Readonly<{ kind: "recipient_unavailable" }>;

export type NotificationReadResult = Readonly<{
  notification: NotificationRecord;
  changed: boolean;
}>;

export interface NotificationRepository {
  projectInTransaction(
    database: DatabaseClient,
    job: OutboxJobRecord
  ): Promise<NotificationProjectionResult>;
  listForPrincipal(
    principal: AuthorizationPrincipal,
    options?: NotificationQueryOptions
  ): Promise<readonly NotificationRecord[]>;
  unreadCountForPrincipal(principal: AuthorizationPrincipal): Promise<number>;
  findForPrincipal(
    principal: AuthorizationPrincipal,
    notificationId: string
  ): Promise<NotificationRecord | null>;
  markReadForPrincipal(
    principal: AuthorizationPrincipal,
    notificationId: string
  ): Promise<NotificationReadResult | null>;
}

export class DatabaseNotificationRepository implements NotificationRepository {
  constructor(
    private readonly clientPromise: Promise<DatabaseClient> = getDatabaseClient()
  ) {}

  private client(): Promise<DatabaseClient> {
    return this.clientPromise;
  }

  async projectInTransaction(
    database: DatabaseClient,
    jobInput: OutboxJobRecord
  ): Promise<NotificationProjectionResult> {
    const job = assertNotificationProjectionJob(jobInput);
    const notificationType = "platform.foundation.ready" as const;
    const content = notificationContent(notificationType);
    const metadata = normalizeNotificationMetadata(
      notificationType,
      job.payload
    ) as FoundationNotificationMetadata;
    const projectionKey = deriveNotificationProjectionKey({
      jobId: job.jobId,
      notificationType,
      recipientAccountId: job.enqueuedByAccountId,
      recipientRole: job.enqueuedByRole,
      tenantId: job.tenantId
    });
    const inserted = await database.query<NotificationRow>(
      NOTIFICATION_INSERT_SQL,
      [
        createNotificationId(),
        notificationType,
        NOTIFICATION_SCHEMA_VERSION,
        job.jobId,
        projectionKey,
        job.enqueuedByAccountId,
        job.enqueuedByRole,
        job.tenantId,
        job.membershipId,
        content.title,
        content.body,
        JSON.stringify(metadata),
        content.target,
        content.targetReference
      ]
    );
    let row = inserted.rows[0];
    let created = true;
    if (!row) {
      created = false;
      const existing = await database.query<NotificationRow>(
        NOTIFICATION_FIND_PROJECTION_SQL,
        [projectionKey]
      );
      row = existing.rows[0];
      if (!row) return Object.freeze({ kind: "recipient_unavailable" });
    }

    const notification = notificationFromRow(row);
    if (
      notification.sourceJobId !== job.jobId ||
      notification.recipientAccountId !== job.enqueuedByAccountId ||
      notification.recipientRole !== job.enqueuedByRole ||
      notification.tenantId !== job.tenantId ||
      notification.membershipId !== job.membershipId ||
      JSON.stringify(notification.metadata) !== JSON.stringify(metadata)
    ) {
      throw new NotificationContractError(
        "Notification projection key resolved inconsistently."
      );
    }
    return Object.freeze({ kind: "projected", created, notification });
  }

  async listForPrincipal(
    principal: AuthorizationPrincipal,
    options: NotificationQueryOptions = {}
  ): Promise<readonly NotificationRecord[]> {
    const cursor = normalizeNotificationCursor(options.beforeSequence);
    const limit = normalizeNotificationLimit(options.limit);
    const database = await this.client();
    return database.transaction(async (transaction) => {
      await assertLivePrincipal(transaction, principal);
      const scope = scopeParameters(principal);
      const result = await transaction.query<NotificationRow>(
        NOTIFICATION_LIST_SQL,
        [...scope, cursor, limit]
      );
      return Object.freeze(result.rows.map(notificationFromRow));
    });
  }

  async unreadCountForPrincipal(
    principal: AuthorizationPrincipal
  ): Promise<number> {
    const database = await this.client();
    return database.transaction(async (transaction) => {
      await assertLivePrincipal(transaction, principal);
      const result = await transaction.query<{ unread_count: number | string }>(
        NOTIFICATION_UNREAD_COUNT_SQL,
        scopeParameters(principal)
      );
      return Number(result.rows[0]?.unread_count ?? 0);
    });
  }

  async findForPrincipal(
    principal: AuthorizationPrincipal,
    notificationIdInput: string
  ): Promise<NotificationRecord | null> {
    const notificationId = normalizeNotificationId(notificationIdInput);
    if (!notificationId) return null;
    const database = await this.client();
    return database.transaction(async (transaction) => {
      await assertLivePrincipal(transaction, principal);
      const scope = scopeParameters(principal);
      const result = await transaction.query<NotificationRow>(
        NOTIFICATION_FIND_SQL,
        [notificationId, ...scope]
      );
      return result.rows[0] ? notificationFromRow(result.rows[0]) : null;
    });
  }

  async markReadForPrincipal(
    principal: AuthorizationPrincipal,
    notificationIdInput: string
  ): Promise<NotificationReadResult | null> {
    const notificationId = normalizeNotificationId(notificationIdInput);
    if (!notificationId) return null;
    const database = await this.client();
    return database.transaction(async (transaction) => {
      await assertLivePrincipal(transaction, principal);
      const scope = scopeParameters(principal);
      const updated = await transaction.query<NotificationRow>(
        NOTIFICATION_MARK_READ_SQL,
        [notificationId, ...scope]
      );
      if (updated.rows[0]) {
        return Object.freeze({
          notification: notificationFromRow(updated.rows[0]),
          changed: true
        });
      }
      const existing = await transaction.query<NotificationRow>(
        NOTIFICATION_FIND_SQL,
        [notificationId, ...scope]
      );
      return existing.rows[0]
        ? Object.freeze({
            notification: notificationFromRow(existing.rows[0]),
            changed: false
          })
        : null;
    });
  }
}

let repository: NotificationRepository | null = null;

export function getNotificationRepository(): NotificationRepository {
  repository ??= new DatabaseNotificationRepository();
  return repository;
}
