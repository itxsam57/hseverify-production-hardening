import "server-only";

import type { AuthorizationPrincipal } from "../authorization/authorization-context-domain";
import type { DatabaseClient } from "../database/database";
import { getDatabaseClient } from "../database/database";
import {
  StaleOutboxLeaseError,
  assertTrustedOutboxLease,
  type OutboxJobRecord,
  type TrustedOutboxLease
} from "../outbox/outbox-domain";
import {
  EMAIL_DELIVERY_SCHEMA_VERSION,
  EmailDeliveryAccessDeniedError,
  EmailDeliveryContractError,
  assertEmailDeliveryJob,
  createEmailAttemptId,
  createEmailDeliveryId,
  deriveEmailDeliveryKey,
  deriveEmailDispatchKey,
  hashEmailRecipientAddress,
  isEmailAdapterKey,
  isEmailAttemptOutcome,
  isEmailDeliveryStatus,
  isEmailDeliveryType,
  normalizeEmailDeliveryCursor,
  normalizeEmailDeliveryId,
  normalizeEmailDeliveryLimit,
  normalizeEmailResultText,
  type EmailAdapterKey,
  type EmailAttemptOutcome,
  type EmailDeliveryAttemptRecord,
  type EmailDeliveryOutboxJob,
  type EmailDeliveryRecord,
  type EmailDeliveryStatus,
  type EmailDeliveryAttemptPreparation
} from "./email-delivery-domain";

export const EMAIL_RECIPIENT_SQL = `
SELECT accounts.email_normalized
FROM auth_accounts AS accounts
JOIN auth_account_roles AS roles
  ON roles.account_id = accounts.account_id
 AND roles.role = $2
WHERE accounts.account_id = $1
  AND accounts.account_status = 'active'
  AND accounts.email_verified_at IS NOT NULL
  AND (
    (
      $2 <> 'company'
      AND $3::text IS NULL
      AND $4::text IS NULL
    ) OR (
      $2 = 'company'
      AND EXISTS (
        SELECT 1
        FROM auth_tenant_memberships AS memberships
        JOIN platform_tenants AS tenants
          ON tenants.tenant_id = memberships.tenant_id
        WHERE memberships.membership_id = $4
          AND memberships.tenant_id = $3
          AND memberships.account_id = $1
          AND memberships.portal_role = 'company'
          AND memberships.membership_status = 'active'
          AND tenants.tenant_status = 'active'
      )
    )
  )`;

export const EMAIL_QUEUE_SQL = `
INSERT INTO platform_email_deliveries (
  delivery_id, delivery_type, schema_version,
  source_job_id, delivery_key,
  recipient_account_id, recipient_role, tenant_id, membership_id,
  recipient_address_hash
) VALUES (
  $1, 'platform.foundation.email', $2,
  $3, $4,
  $5, $6, $7, $8,
  $9
)
ON CONFLICT (delivery_key) DO NOTHING
RETURNING *`;

export const EMAIL_FIND_BY_KEY_SQL = `
SELECT *
FROM platform_email_deliveries
WHERE delivery_key = $1`;

export const EMAIL_FIND_BY_JOB_SQL = `
SELECT *
FROM platform_email_deliveries
WHERE source_job_id = $1`;

export const EMAIL_RECONCILE_EXPIRED_ATTEMPTS_SQL = `
UPDATE platform_email_delivery_attempts AS email_attempts
SET outcome = 'lease_expired',
    result_code = 'lease_expired',
    result_summary = 'The prior email delivery worker lease expired before completion.',
    provider_reference_hash = NULL,
    finished_at = CURRENT_TIMESTAMP
FROM platform_outbox_job_attempts AS outbox_attempts
WHERE email_attempts.delivery_id = $1
  AND email_attempts.outcome = 'running'
  AND outbox_attempts.attempt_id = email_attempts.source_outbox_attempt_id
  AND outbox_attempts.outcome = 'lease_expired'
RETURNING email_attempts.*`;

export const EMAIL_RECONCILE_DELIVERY_SQL = `
UPDATE platform_email_deliveries
SET status = 'retry_wait',
    last_result_code = 'lease_expired',
    last_result_summary = 'The prior email delivery worker lease expired before completion.',
    updated_at = CURRENT_TIMESTAMP
WHERE delivery_id = $1
  AND status = 'processing'
RETURNING *`;

export const EMAIL_INSERT_ATTEMPT_SQL = `
INSERT INTO platform_email_delivery_attempts (
  email_attempt_id, delivery_id, source_job_id, source_outbox_attempt_id,
  attempt_number, worker_id, lease_id, adapter_key, dispatch_key
)
SELECT
  $1, deliveries.delivery_id, jobs.job_id, outbox_attempts.attempt_id,
  $4, $5, $6, $7, $8
FROM platform_email_deliveries AS deliveries
JOIN platform_outbox_jobs AS jobs
  ON jobs.job_id = deliveries.source_job_id
JOIN platform_outbox_job_attempts AS outbox_attempts
  ON outbox_attempts.attempt_id = $3
 AND outbox_attempts.job_id = jobs.job_id
WHERE jobs.job_id = $2
  AND jobs.job_type = 'email.delivery.foundation'
  AND jobs.status = 'leased'
  AND jobs.lease_id = $6
  AND jobs.worker_id = $5
  AND jobs.lease_expires_at > CURRENT_TIMESTAMP
  AND outbox_attempts.attempt_number::smallint = $4
  AND outbox_attempts.worker_id = $5
  AND outbox_attempts.lease_id = $6
  AND outbox_attempts.outcome = 'running'
  AND deliveries.status IN ('queued', 'retry_wait', 'processing')
ON CONFLICT (source_outbox_attempt_id) DO NOTHING
RETURNING *`;

export const EMAIL_FIND_ATTEMPT_BY_OUTBOX_ATTEMPT_SQL = `
SELECT *
FROM platform_email_delivery_attempts
WHERE source_outbox_attempt_id = $1`;

export const EMAIL_MARK_PROCESSING_SQL = `
UPDATE platform_email_deliveries
SET status = 'processing',
    attempt_count = $2,
    last_result_code = NULL,
    last_result_summary = NULL,
    updated_at = CURRENT_TIMESTAMP
WHERE delivery_id = $1
  AND status IN ('queued', 'retry_wait')
  AND attempt_count < $2
RETURNING *`;

export const EMAIL_FINALIZE_ATTEMPT_SQL = `
UPDATE platform_email_delivery_attempts AS attempts
SET outcome = $5,
    result_code = $6,
    result_summary = $7,
    provider_reference_hash = $8,
    finished_at = CURRENT_TIMESTAMP
FROM platform_outbox_jobs AS jobs
WHERE attempts.source_outbox_attempt_id = $1
  AND attempts.source_job_id = $2
  AND attempts.worker_id = $3
  AND attempts.lease_id = $4
  AND attempts.outcome = 'running'
  AND jobs.job_id = attempts.source_job_id
  AND jobs.status = 'leased'
  AND jobs.lease_id = $4
  AND jobs.worker_id = $3
  AND jobs.lease_expires_at > CURRENT_TIMESTAMP
RETURNING attempts.*`;

export const EMAIL_FINALIZE_DELIVERY_SQL = `
UPDATE platform_email_deliveries
SET status = $2,
    attempt_count = $3,
    last_result_code = $4,
    last_result_summary = $5,
    updated_at = CURRENT_TIMESTAMP
WHERE delivery_id = $1
  AND status = 'processing'
RETURNING *`;

export const EMAIL_SESSION_GUARD_SQL = `
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

export const EMAIL_COMPANY_SCOPE_GUARD_SQL = `
SELECT memberships.membership_id
FROM auth_tenant_memberships AS memberships
JOIN platform_tenants AS tenants
  ON tenants.tenant_id = memberships.tenant_id
WHERE memberships.membership_id = $1
  AND memberships.tenant_id = $2
  AND memberships.account_id = $3
  AND memberships.portal_role = 'company'
  AND memberships.membership_status = 'active'
  AND tenants.tenant_status = 'active'
FOR UPDATE OF memberships, tenants`;

export const EMAIL_LIST_SQL = `
SELECT *
FROM platform_email_deliveries
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
  AND ($5::bigint IS NULL OR delivery_sequence < $5::bigint)
ORDER BY delivery_sequence DESC
LIMIT $6`;

export const EMAIL_FIND_SCOPED_SQL = `
SELECT *
FROM platform_email_deliveries
WHERE delivery_id = $1
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

export const EMAIL_ATTEMPTS_SCOPED_SQL = `
SELECT attempts.*
FROM platform_email_delivery_attempts AS attempts
JOIN platform_email_deliveries AS deliveries
  ON deliveries.delivery_id = attempts.delivery_id
WHERE deliveries.delivery_id = $1
  AND deliveries.recipient_account_id = $2
  AND deliveries.recipient_role = $3
  AND (
    (
      $3 = 'company'
      AND deliveries.tenant_id = $4
      AND deliveries.membership_id = $5
    ) OR (
      $3 <> 'company'
      AND deliveries.tenant_id IS NULL
      AND deliveries.membership_id IS NULL
    )
  )
ORDER BY attempts.attempt_number DESC
LIMIT $6`;

type DeliveryRow = {
  delivery_sequence: number | string;
  delivery_id: string;
  delivery_type: string;
  schema_version: number | string;
  source_job_id: string;
  delivery_key: string;
  recipient_account_id: string;
  recipient_role: string;
  tenant_id: string | null;
  membership_id: string | null;
  recipient_address_hash: string;
  status: string;
  attempt_count: number | string;
  last_result_code: string | null;
  last_result_summary: string | null;
  delivered_at: string | Date | null;
  terminal_failed_at: string | Date | null;
  created_at: string | Date;
  updated_at: string | Date;
};

type EmailAttemptRow = {
  attempt_sequence: number | string;
  email_attempt_id: string;
  delivery_id: string;
  source_job_id: string;
  source_outbox_attempt_id: string;
  attempt_number: number | string;
  worker_id: string;
  lease_id: string;
  adapter_key: string;
  dispatch_key: string;
  outcome: string;
  result_code: string | null;
  result_summary: string | null;
  provider_reference_hash: string | null;
  started_at: string | Date;
  finished_at: string | Date | null;
};

function timestamp(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function optionalTimestamp(value: string | Date | null): string | null {
  return value === null ? null : timestamp(value);
}

function deliveryFromRow(row: DeliveryRow): EmailDeliveryRecord {
  if (
    !isEmailDeliveryType(row.delivery_type) ||
    !isEmailDeliveryStatus(row.status) ||
    Number(row.schema_version) !== EMAIL_DELIVERY_SCHEMA_VERSION
  ) {
    throw new EmailDeliveryContractError(
      "Stored email delivery vocabulary is invalid."
    );
  }
  if (!/^[a-f0-9]{64}$/.test(row.recipient_address_hash)) {
    throw new EmailDeliveryContractError(
      "Stored email recipient fingerprint is invalid."
    );
  }
  return Object.freeze({
    sequence: Number(row.delivery_sequence),
    deliveryId: row.delivery_id,
    deliveryType: row.delivery_type,
    schemaVersion: EMAIL_DELIVERY_SCHEMA_VERSION,
    sourceJobId: row.source_job_id,
    deliveryKey: row.delivery_key,
    recipientAccountId: row.recipient_account_id,
    recipientRole: row.recipient_role as EmailDeliveryRecord["recipientRole"],
    tenantId: row.tenant_id,
    membershipId: row.membership_id,
    recipientAddressHash: row.recipient_address_hash,
    status: row.status,
    attemptCount: Number(row.attempt_count),
    lastResultCode: row.last_result_code,
    lastResultSummary: row.last_result_summary,
    deliveredAt: optionalTimestamp(row.delivered_at),
    terminalFailedAt: optionalTimestamp(row.terminal_failed_at),
    createdAt: timestamp(row.created_at),
    updatedAt: timestamp(row.updated_at)
  });
}

function attemptFromRow(row: EmailAttemptRow): EmailDeliveryAttemptRecord {
  if (!isEmailAttemptOutcome(row.outcome) || !isEmailAdapterKey(row.adapter_key)) {
    throw new EmailDeliveryContractError(
      "Stored email delivery attempt vocabulary is invalid."
    );
  }
  return Object.freeze({
    sequence: Number(row.attempt_sequence),
    emailAttemptId: row.email_attempt_id,
    deliveryId: row.delivery_id,
    sourceJobId: row.source_job_id,
    sourceOutboxAttemptId: row.source_outbox_attempt_id,
    attemptNumber: Number(row.attempt_number),
    workerId: row.worker_id,
    leaseId: row.lease_id,
    adapterKey: row.adapter_key,
    dispatchKey: row.dispatch_key,
    outcome: row.outcome,
    resultCode: row.result_code,
    resultSummary: row.result_summary,
    providerReferenceHash: row.provider_reference_hash,
    startedAt: timestamp(row.started_at),
    finishedAt: optionalTimestamp(row.finished_at)
  });
}

async function resolveRecipientAddress(
  database: DatabaseClient,
  job: EmailDeliveryOutboxJob
): Promise<string | null> {
  const result = await database.query<{ email_normalized: string }>(
    EMAIL_RECIPIENT_SQL,
    [
      job.enqueuedByAccountId,
      job.enqueuedByRole,
      job.tenantId,
      job.membershipId
    ]
  );
  return result.rows[0]?.email_normalized ?? null;
}

async function assertLivePrincipal(
  database: DatabaseClient,
  principal: AuthorizationPrincipal
): Promise<void> {
  const session = await database.query<{ session_id: string }>(
    EMAIL_SESSION_GUARD_SQL,
    [principal.sessionId, principal.accountId, principal.activeRole]
  );
  if (session.rows[0]?.session_id !== principal.sessionId) {
    throw new EmailDeliveryAccessDeniedError();
  }

  if (principal.activeRole === "company") {
    const membership = principal.tenantMembership;
    if (!membership) throw new EmailDeliveryAccessDeniedError();
    const scope = await database.query<{ membership_id: string }>(
      EMAIL_COMPANY_SCOPE_GUARD_SQL,
      [membership.membershipId, membership.tenantId, principal.accountId]
    );
    if (scope.rows[0]?.membership_id !== membership.membershipId) {
      throw new EmailDeliveryAccessDeniedError();
    }
  } else if (principal.tenantMembership !== null) {
    throw new EmailDeliveryAccessDeniedError();
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

export type EmailDeliveryQueryOptions = Readonly<{
  beforeSequence?: number | null;
  limit?: number;
}>;

export type QueueEmailDeliveryResult = Readonly<{
  delivery: EmailDeliveryRecord;
  created: boolean;
}>;

export type FinalizeEmailAttemptInput = Readonly<{
  outcome: Exclude<EmailAttemptOutcome, "running" | "lease_expired">;
  status: Extract<EmailDeliveryStatus, "retry_wait" | "delivered" | "terminal_failed">;
  code: string;
  summary: string;
  providerReferenceHash?: string | null;
}>;

export interface EmailDeliveryRepository {
  queueInTransaction(
    database: DatabaseClient,
    job: OutboxJobRecord
  ): Promise<QueueEmailDeliveryResult>;
  beginAttemptInTransaction(
    database: DatabaseClient,
    job: OutboxJobRecord,
    lease: TrustedOutboxLease,
    adapterKey: EmailAdapterKey
  ): Promise<EmailDeliveryAttemptPreparation>;
  finalizeAttemptInTransaction(
    database: DatabaseClient,
    job: OutboxJobRecord,
    lease: TrustedOutboxLease,
    input: FinalizeEmailAttemptInput
  ): Promise<Readonly<{
    delivery: EmailDeliveryRecord;
    attempt: EmailDeliveryAttemptRecord;
    changed: boolean;
  }>>;
  listForPrincipal(
    principal: AuthorizationPrincipal,
    options?: EmailDeliveryQueryOptions
  ): Promise<readonly EmailDeliveryRecord[]>;
  findForPrincipal(
    principal: AuthorizationPrincipal,
    deliveryId: string
  ): Promise<EmailDeliveryRecord | null>;
  listAttemptsForPrincipal(
    principal: AuthorizationPrincipal,
    deliveryId: string,
    limit?: number
  ): Promise<readonly EmailDeliveryAttemptRecord[]>;
}

export class DatabaseEmailDeliveryRepository implements EmailDeliveryRepository {
  constructor(
    private readonly clientPromise: Promise<DatabaseClient> = getDatabaseClient()
  ) {}

  private client(): Promise<DatabaseClient> {
    return this.clientPromise;
  }

  async queueInTransaction(
    database: DatabaseClient,
    jobInput: OutboxJobRecord
  ): Promise<QueueEmailDeliveryResult> {
    const job = assertEmailDeliveryJob(jobInput);
    const recipientAddress = await resolveRecipientAddress(database, job);
    if (!recipientAddress) {
      throw new EmailDeliveryContractError(
        "Trusted email recipient is unavailable for queue creation."
      );
    }
    const recipientAddressHash = hashEmailRecipientAddress(recipientAddress);
    const deliveryKey = deriveEmailDeliveryKey(job);
    const inserted = await database.query<DeliveryRow>(EMAIL_QUEUE_SQL, [
      createEmailDeliveryId(),
      EMAIL_DELIVERY_SCHEMA_VERSION,
      job.jobId,
      deliveryKey,
      job.enqueuedByAccountId,
      job.enqueuedByRole,
      job.tenantId,
      job.membershipId,
      recipientAddressHash
    ]);
    let row = inserted.rows[0];
    let created = true;
    if (!row) {
      created = false;
      const existing = await database.query<DeliveryRow>(EMAIL_FIND_BY_KEY_SQL, [
        deliveryKey
      ]);
      row = existing.rows[0];
      if (!row) {
        throw new EmailDeliveryContractError(
          "Deduplicated email delivery record was not found."
        );
      }
    }
    const delivery = deliveryFromRow(row);
    if (
      delivery.sourceJobId !== job.jobId ||
      delivery.recipientAccountId !== job.enqueuedByAccountId ||
      delivery.recipientRole !== job.enqueuedByRole ||
      delivery.tenantId !== job.tenantId ||
      delivery.membershipId !== job.membershipId ||
      delivery.recipientAddressHash !== recipientAddressHash
    ) {
      throw new EmailDeliveryContractError(
        "Email delivery idempotency key resolved inconsistently."
      );
    }
    return Object.freeze({ delivery, created });
  }

  async beginAttemptInTransaction(
    database: DatabaseClient,
    jobInput: OutboxJobRecord,
    leaseInput: TrustedOutboxLease,
    adapterKey: EmailAdapterKey
  ): Promise<EmailDeliveryAttemptPreparation> {
    const job = assertEmailDeliveryJob(jobInput);
    const lease = assertTrustedOutboxLease(leaseInput);
    if (lease.jobId !== job.jobId || !isEmailAdapterKey(adapterKey)) {
      throw new StaleOutboxLeaseError();
    }

    const deliveryResult = await database.query<DeliveryRow>(EMAIL_FIND_BY_JOB_SQL, [
      job.jobId
    ]);
    let delivery = deliveryResult.rows[0]
      ? deliveryFromRow(deliveryResult.rows[0])
      : null;
    if (!delivery) {
      throw new EmailDeliveryContractError(
        "Email delivery record is missing for the claimed outbox job."
      );
    }

    if (delivery.status === "delivered") {
      return Object.freeze({ kind: "already_delivered" as const, delivery });
    }
    if (delivery.status === "terminal_failed") {
      return Object.freeze({ kind: "already_terminal" as const, delivery });
    }

    const expired = await database.query<EmailAttemptRow>(
      EMAIL_RECONCILE_EXPIRED_ATTEMPTS_SQL,
      [delivery.deliveryId]
    );
    if (expired.rows.length > 0 && delivery.status === "processing") {
      const reconciled = await database.query<DeliveryRow>(
        EMAIL_RECONCILE_DELIVERY_SQL,
        [delivery.deliveryId]
      );
      if (reconciled.rows[0]) delivery = deliveryFromRow(reconciled.rows[0]);
    }

    if (delivery.status === "delivered") {
      return Object.freeze({ kind: "already_delivered" as const, delivery });
    }
    if (delivery.status === "terminal_failed") {
      return Object.freeze({ kind: "already_terminal" as const, delivery });
    }

    const dispatchKey = deriveEmailDispatchKey(delivery.deliveryId, lease);
    const inserted = await database.query<EmailAttemptRow>(EMAIL_INSERT_ATTEMPT_SQL, [
      createEmailAttemptId(),
      job.jobId,
      lease.attemptId,
      lease.attemptNumber,
      lease.workerId,
      lease.leaseId,
      adapterKey,
      dispatchKey
    ]);
    const created = Boolean(inserted.rows[0]);
    let attemptRow = inserted.rows[0];
    if (!attemptRow) {
      const existing = await database.query<EmailAttemptRow>(
        EMAIL_FIND_ATTEMPT_BY_OUTBOX_ATTEMPT_SQL,
        [lease.attemptId]
      );
      attemptRow = existing.rows[0];
      if (!attemptRow) throw new StaleOutboxLeaseError();
    }
    const attempt = attemptFromRow(attemptRow);
    if (
      attempt.deliveryId !== delivery.deliveryId ||
      attempt.sourceJobId !== job.jobId ||
      attempt.attemptNumber !== lease.attemptNumber ||
      attempt.workerId !== lease.workerId ||
      attempt.leaseId !== lease.leaseId ||
      attempt.adapterKey !== adapterKey ||
      attempt.dispatchKey !== dispatchKey
    ) {
      throw new StaleOutboxLeaseError();
    }

    if (created) {
      const processing = await database.query<DeliveryRow>(
        EMAIL_MARK_PROCESSING_SQL,
        [delivery.deliveryId, lease.attemptNumber]
      );
      const processingRow = processing.rows[0];
      if (!processingRow) throw new StaleOutboxLeaseError();
      delivery = deliveryFromRow(processingRow);
    }

    const recipientAddress = await resolveRecipientAddress(database, job);
    if (
      !recipientAddress ||
      hashEmailRecipientAddress(recipientAddress) !== delivery.recipientAddressHash
    ) {
      return Object.freeze({
        kind: "attempt" as const,
        created,
        delivery,
        attempt,
        recipientAddress: ""
      });
    }

    return Object.freeze({
      kind: "attempt" as const,
      created,
      delivery,
      attempt,
      recipientAddress
    });
  }

  async finalizeAttemptInTransaction(
    database: DatabaseClient,
    jobInput: OutboxJobRecord,
    leaseInput: TrustedOutboxLease,
    input: FinalizeEmailAttemptInput
  ): Promise<Readonly<{
    delivery: EmailDeliveryRecord;
    attempt: EmailDeliveryAttemptRecord;
    changed: boolean;
  }>> {
    const job = assertEmailDeliveryJob(jobInput);
    const lease = assertTrustedOutboxLease(leaseInput);
    if (lease.jobId !== job.jobId) throw new StaleOutboxLeaseError();
    if (
      input.outcome === "delivered" && input.status !== "delivered" ||
      input.outcome === "retryable_failure" && input.status !== "retry_wait" ||
      input.outcome === "terminal_failure" && input.status !== "terminal_failed"
    ) {
      throw new EmailDeliveryContractError(
        "Email attempt outcome and delivery status do not agree."
      );
    }
    const result = normalizeEmailResultText({
      code: input.code,
      summary: input.summary
    });
    const providerReferenceHash = input.providerReferenceHash ?? null;
    if (
      (input.outcome === "delivered" && !/^[a-f0-9]{64}$/.test(providerReferenceHash ?? "")) ||
      (input.outcome !== "delivered" && providerReferenceHash !== null)
    ) {
      throw new EmailDeliveryContractError(
        "Email provider reference fingerprint does not match the outcome."
      );
    }

    const updatedAttempt = await database.query<EmailAttemptRow>(
      EMAIL_FINALIZE_ATTEMPT_SQL,
      [
        lease.attemptId,
        job.jobId,
        lease.workerId,
        lease.leaseId,
        input.outcome,
        result.code,
        result.summary,
        providerReferenceHash
      ]
    );
    if (!updatedAttempt.rows[0]) {
      const existing = await database.query<EmailAttemptRow>(
        EMAIL_FIND_ATTEMPT_BY_OUTBOX_ATTEMPT_SQL,
        [lease.attemptId]
      );
      const existingRow = existing.rows[0];
      if (!existingRow) throw new StaleOutboxLeaseError();
      const attempt = attemptFromRow(existingRow);
      if (
        attempt.outcome !== input.outcome ||
        attempt.resultCode !== result.code ||
        attempt.resultSummary !== result.summary ||
        attempt.providerReferenceHash !== providerReferenceHash
      ) {
        throw new StaleOutboxLeaseError();
      }
      const current = await database.query<DeliveryRow>(EMAIL_FIND_BY_JOB_SQL, [
        job.jobId
      ]);
      if (!current.rows[0]) throw new StaleOutboxLeaseError();
      return Object.freeze({
        delivery: deliveryFromRow(current.rows[0]),
        attempt,
        changed: false
      });
    }

    const finalizedDelivery = await database.query<DeliveryRow>(
      EMAIL_FINALIZE_DELIVERY_SQL,
      [
        attemptFromRow(updatedAttempt.rows[0]).deliveryId,
        input.status,
        lease.attemptNumber,
        result.code,
        result.summary
      ]
    );
    if (!finalizedDelivery.rows[0]) throw new StaleOutboxLeaseError();

    return Object.freeze({
      delivery: deliveryFromRow(finalizedDelivery.rows[0]),
      attempt: attemptFromRow(updatedAttempt.rows[0]),
      changed: true
    });
  }

  async listForPrincipal(
    principal: AuthorizationPrincipal,
    options: EmailDeliveryQueryOptions = {}
  ): Promise<readonly EmailDeliveryRecord[]> {
    const cursor = normalizeEmailDeliveryCursor(options.beforeSequence);
    const limit = normalizeEmailDeliveryLimit(options.limit);
    const database = await this.client();
    return database.transaction(async (transaction) => {
      await assertLivePrincipal(transaction, principal);
      const rows = await transaction.query<DeliveryRow>(EMAIL_LIST_SQL, [
        ...scopeParameters(principal),
        cursor,
        limit
      ]);
      return Object.freeze(rows.rows.map(deliveryFromRow));
    });
  }

  async findForPrincipal(
    principal: AuthorizationPrincipal,
    deliveryIdInput: string
  ): Promise<EmailDeliveryRecord | null> {
    const deliveryId = normalizeEmailDeliveryId(deliveryIdInput);
    if (!deliveryId) return null;
    const database = await this.client();
    return database.transaction(async (transaction) => {
      await assertLivePrincipal(transaction, principal);
      const row = await transaction.query<DeliveryRow>(EMAIL_FIND_SCOPED_SQL, [
        deliveryId,
        ...scopeParameters(principal)
      ]);
      return row.rows[0] ? deliveryFromRow(row.rows[0]) : null;
    });
  }

  async listAttemptsForPrincipal(
    principal: AuthorizationPrincipal,
    deliveryIdInput: string,
    limitInput?: number
  ): Promise<readonly EmailDeliveryAttemptRecord[]> {
    const deliveryId = normalizeEmailDeliveryId(deliveryIdInput);
    if (!deliveryId) return Object.freeze([]);
    const limit = normalizeEmailDeliveryLimit(limitInput);
    const database = await this.client();
    return database.transaction(async (transaction) => {
      await assertLivePrincipal(transaction, principal);
      const rows = await transaction.query<EmailAttemptRow>(
        EMAIL_ATTEMPTS_SCOPED_SQL,
        [deliveryId, ...scopeParameters(principal), limit]
      );
      return Object.freeze(rows.rows.map(attemptFromRow));
    });
  }
}

let repository: EmailDeliveryRepository | null = null;

export function getEmailDeliveryRepository(): EmailDeliveryRepository {
  repository ??= new DatabaseEmailDeliveryRepository();
  return repository;
}
