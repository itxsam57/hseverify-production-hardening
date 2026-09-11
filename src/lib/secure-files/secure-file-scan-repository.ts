import "server-only";

import {
  bindTrustedAuditActor,
  bindTrustedCompanyApplicationAuditActor,
  bindTrustedSystemAuditActor,
  type TrustedAuditActor
} from "../audit/audit-domain";
import { DatabaseAuditRepository } from "../audit/audit-repository";
import type { AuthorizationPrincipal } from "../authorization/authorization-context-domain";
import type { DatabaseClient } from "../database/database";
import { getDatabaseClient } from "../database/database";
import {
  assertTrustedOutboxLease,
  deriveOutboxIdempotencyKey,
  normalizeOutboxPayload,
  type OutboxJobRecord,
  type TrustedOutboxLease
} from "../outbox/outbox-domain";
import { DatabaseOutboxRepository } from "../outbox/outbox-repository";
import {
  SecureFileAccessDeniedError,
  SecureFileContractError,
  bindTrustedCompanyApplicationSecureFileOwner,
  bindTrustedSecureFileOwner,
  type TrustedSecureFileOwner
} from "./secure-file-domain";
import {
  SECURE_FILE_SCAN_JOB_TYPE,
  SecureFileScanAccessDeniedError,
  SecureFileScanConflictError,
  SecureFileScanContractError,
  deriveSecureFileScanBusinessKey,
  normalizeMalwareScanResult,
  normalizeSecureFileScanGeneration
} from "./secure-file-scan-domain";

export type SecureFileScanState = Readonly<{
  fileRef: string;
  ownerAccountId: string;
  ownerRole: AuthorizationPrincipal["activeRole"];
  tenantId: string | null;
  membershipId: string | null;
  objectKey: string;
  lifecycleStatus: "reserved" | "quarantined" | "scan_pending" | "available" | "unsafe" | "scan_failed";
  byteSize: number | null;
  contentSha256: string | null;
  quarantinedAt: string | null;
  scanGeneration: number;
  scanJobId: string | null;
  scanResultCode: string | null;
  scanCompletedAt: string | null;
}>;

export type SecureFileScanScheduleResult = Readonly<{
  created: boolean;
  fileRef: string;
  generation: number;
  jobId: string;
}>;

export const SECURE_FILE_SCAN_SESSION_GUARD_SQL = `
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

export const SECURE_FILE_SCAN_COMPANY_SCOPE_GUARD_SQL = `
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

export const SECURE_FILE_SCAN_COMPANY_APPLICATION_SCOPE_GUARD_SQL = `
SELECT memberships.membership_id
FROM auth_tenant_memberships AS memberships
JOIN platform_tenants AS tenants
  ON tenants.tenant_id = memberships.tenant_id
WHERE memberships.membership_id = $1
  AND memberships.tenant_id = $2
  AND memberships.account_id = $3
  AND memberships.portal_role = 'company'
  AND memberships.membership_status = 'active'
  AND memberships.membership_role IN ('owner', 'admin')
  AND tenants.tenant_status IN ('pending', 'active')
FOR UPDATE OF memberships, tenants`;

export const SECURE_FILE_SCAN_OWNER_LOCK_SQL = `
SELECT file_id, owner_account_id, owner_role, tenant_id, membership_id,
       object_key, lifecycle_status, byte_size, content_sha256, quarantined_at,
       scan_generation, scan_job_id, scan_result_code, scan_completed_at
FROM platform_secure_files
WHERE file_id = $1
  AND owner_account_id = $2
  AND owner_role = $3
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
FOR UPDATE`;

export const SECURE_FILE_SCAN_MARK_PENDING_SQL = `
UPDATE platform_secure_files
SET lifecycle_status = 'scan_pending',
    scan_generation = $6,
    scan_job_id = $7,
    scan_result_code = NULL,
    scan_completed_at = NULL
WHERE file_id = $1
  AND owner_account_id = $2
  AND owner_role = $3
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
  AND lifecycle_status = $8
RETURNING file_id, owner_account_id, owner_role, tenant_id, membership_id,
          object_key, lifecycle_status, byte_size, content_sha256, quarantined_at,
          scan_generation, scan_job_id, scan_result_code, scan_completed_at`;

export const SECURE_FILE_SCAN_HANDLER_LOCK_SQL = `
SELECT file_id, owner_account_id, owner_role, tenant_id, membership_id,
       object_key, lifecycle_status, byte_size, content_sha256, quarantined_at,
       scan_generation, scan_job_id, scan_result_code, scan_completed_at
FROM platform_secure_files
WHERE file_id = $1
  AND scan_generation = $2
  AND scan_job_id = $3
  AND owner_account_id = $4
  AND owner_role = $5
  AND (
    (
      $5 = 'company'
      AND tenant_id = $6
      AND membership_id = $7
    ) OR (
      $5 <> 'company'
      AND tenant_id IS NULL
      AND membership_id IS NULL
    )
  )
FOR UPDATE`;

export const SECURE_FILE_SCAN_ACTIVE_LEASE_SQL = `
SELECT job_id
FROM platform_outbox_jobs
WHERE job_id = $1
  AND job_type = 'secure_file.scan'
  AND schema_version = 1
  AND status = 'leased'
  AND lease_id = $2
  AND worker_id = $3
  AND attempt_count = $4
  AND lease_expires_at > CURRENT_TIMESTAMP
  AND enqueued_by_account_id = $5
  AND enqueued_by_role = $6
  AND (
    (
      $6 = 'company'
      AND tenant_id = $7
      AND membership_id = $8
    ) OR (
      $6 <> 'company'
      AND tenant_id IS NULL
      AND membership_id IS NULL
    )
  )
  AND payload ->> 'fileRef' = $9
  AND (payload ->> 'generation')::integer = $10
FOR UPDATE`;

export const SECURE_FILE_SCAN_FINALIZE_SQL = `
UPDATE platform_secure_files
SET lifecycle_status = $8,
    scan_result_code = $9
WHERE file_id = $1
  AND scan_generation = $2
  AND scan_job_id = $3
  AND owner_account_id = $4
  AND owner_role = $5
  AND (
    (
      $5 = 'company'
      AND tenant_id = $6
      AND membership_id = $7
    ) OR (
      $5 <> 'company'
      AND tenant_id IS NULL
      AND membership_id IS NULL
    )
  )
  AND lifecycle_status = 'scan_pending'
RETURNING file_id, owner_account_id, owner_role, tenant_id, membership_id,
          object_key, lifecycle_status, byte_size, content_sha256, quarantined_at,
          scan_generation, scan_job_id, scan_result_code, scan_completed_at`;

type ScanRow = {
  file_id: string;
  owner_account_id: string;
  owner_role: AuthorizationPrincipal["activeRole"];
  tenant_id: string | null;
  membership_id: string | null;
  object_key: string;
  lifecycle_status: SecureFileScanState["lifecycleStatus"];
  byte_size: number | string | null;
  content_sha256: string | null;
  quarantined_at: string | Date | null;
  scan_generation: number | string;
  scan_job_id: string | null;
  scan_result_code: string | null;
  scan_completed_at: string | Date | null;
};

function optionalTimestamp(value: string | Date | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function scanStateFromRow(row: ScanRow): SecureFileScanState {
  const byteSize = row.byte_size === null ? null : Number(row.byte_size);
  const generation = Number(row.scan_generation);
  if (
    !/^secure_file_[A-Za-z0-9_-]{24}$/.test(row.file_id) ||
    !/^secure-files\/[a-f0-9]{64}$/.test(row.object_key) ||
    !["reserved", "quarantined", "scan_pending", "available", "unsafe", "scan_failed"].includes(row.lifecycle_status) ||
    !Number.isSafeInteger(generation) ||
    generation < 0 ||
    (byteSize !== null && (!Number.isSafeInteger(byteSize) || byteSize < 1)) ||
    (row.content_sha256 !== null && !/^[a-f0-9]{64}$/.test(row.content_sha256))
  ) {
    throw new SecureFileContractError("Stored secure file scan state is invalid.");
  }
  return Object.freeze({
    fileRef: row.file_id,
    ownerAccountId: row.owner_account_id,
    ownerRole: row.owner_role,
    tenantId: row.tenant_id,
    membershipId: row.membership_id,
    objectKey: row.object_key,
    lifecycleStatus: row.lifecycle_status,
    byteSize,
    contentSha256: row.content_sha256,
    quarantinedAt: optionalTimestamp(row.quarantined_at),
    scanGeneration: generation,
    scanJobId: row.scan_job_id,
    scanResultCode: row.scan_result_code,
    scanCompletedAt: optionalTimestamp(row.scan_completed_at)
  });
}

function ownerParameters(
  fileRef: string,
  owner: TrustedSecureFileOwner
): readonly [string, string, string, string | null, string | null] {
  return [fileRef, owner.accountId, owner.role, owner.tenantId, owner.membershipId];
}

async function assertLiveOwner(
  database: DatabaseClient,
  owner: TrustedSecureFileOwner
): Promise<void> {
  const session = await database.query<{ session_id: string }>(
    SECURE_FILE_SCAN_SESSION_GUARD_SQL,
    [owner.sessionId, owner.accountId, owner.role]
  );
  if (session.rows[0]?.session_id !== owner.sessionId) {
    throw new SecureFileAccessDeniedError();
  }
  if (owner.role === "company") {
    if (!owner.tenantId || !owner.membershipId) {
      throw new SecureFileAccessDeniedError();
    }
    const guardSql = owner.authorityMode === "company_application"
      ? SECURE_FILE_SCAN_COMPANY_APPLICATION_SCOPE_GUARD_SQL
      : SECURE_FILE_SCAN_COMPANY_SCOPE_GUARD_SQL;
    const membership = await database.query<{ membership_id: string }>(
      guardSql,
      [owner.membershipId, owner.tenantId, owner.accountId]
    );
    if (membership.rows[0]?.membership_id !== owner.membershipId) {
      throw new SecureFileAccessDeniedError();
    }
  } else if (
    owner.tenantId !== null ||
    owner.membershipId !== null ||
    owner.authorityMode !== "active_tenant"
  ) {
    throw new SecureFileAccessDeniedError();
  }
}

function assertScannableState(file: SecureFileScanState): void {
  if (
    file.byteSize === null ||
    file.contentSha256 === null ||
    file.quarantinedAt === null
  ) {
    throw new SecureFileScanConflictError();
  }
}

function normalizeFinalDecision(input: {
  finalStatus: "available" | "unsafe";
  resultCode: string;
}): Readonly<{ finalStatus: "available" | "unsafe"; resultCode: string }> {
  if (input.finalStatus === "available") {
    if (input.resultCode !== "clean") {
      throw new SecureFileScanContractError(
        "Available secure file requires the clean scanner result."
      );
    }
    return Object.freeze({ finalStatus: "available" as const, resultCode: "clean" });
  }
  const normalized = normalizeMalwareScanResult({
    kind: "malicious",
    code: input.resultCode
  });
  if (normalized.kind !== "malicious") {
    throw new SecureFileScanContractError("Unsafe scanner result is invalid.");
  }
  return Object.freeze({
    finalStatus: "unsafe" as const,
    resultCode: normalized.code
  });
}

function trustedOutboxScopeReference(job: OutboxJobRecord): string {
  return job.tenantId === null
    ? `account:${job.enqueuedByAccountId}`
    : `tenant:${job.tenantId}`;
}

function assertScanJobBinding(job: OutboxJobRecord, file: SecureFileScanState): void {
  if (job.jobType !== SECURE_FILE_SCAN_JOB_TYPE) {
    throw new SecureFileScanContractError("Unexpected outbox job type.");
  }
  const payload = normalizeOutboxPayload(SECURE_FILE_SCAN_JOB_TYPE, job.payload);
  if (
    payload.fileRef !== file.fileRef ||
    payload.generation !== file.scanGeneration ||
    job.jobId !== file.scanJobId ||
    job.enqueuedByAccountId !== file.ownerAccountId ||
    job.enqueuedByRole !== file.ownerRole ||
    job.tenantId !== file.tenantId ||
    job.membershipId !== file.membershipId ||
    file.contentSha256 === null
  ) {
    throw new SecureFileScanAccessDeniedError();
  }
  const expectedIdempotency = deriveOutboxIdempotencyKey(
    SECURE_FILE_SCAN_JOB_TYPE,
    deriveSecureFileScanBusinessKey({
      fileRef: file.fileRef,
      contentSha256: file.contentSha256,
      generation: file.scanGeneration
    }),
    trustedOutboxScopeReference(job)
  );
  if (job.idempotencyKey !== expectedIdempotency) {
    throw new SecureFileScanAccessDeniedError();
  }
}

export class DatabaseSecureFileScanRepository {
  constructor(
    private readonly clientPromise: Promise<DatabaseClient> = getDatabaseClient()
  ) {}

  async scheduleForPrincipal(input: {
    principal: AuthorizationPrincipal;
    fileRef: string;
  }): Promise<SecureFileScanScheduleResult> {
    return this.scheduleForAuthority({
      owner: bindTrustedSecureFileOwner(input.principal),
      actor: bindTrustedAuditActor(input.principal),
      fileRef: input.fileRef
    });
  }

  async scheduleForCompanyApplication(input: {
    principal: AuthorizationPrincipal;
    fileRef: string;
  }): Promise<SecureFileScanScheduleResult> {
    return this.scheduleForAuthority({
      owner: bindTrustedCompanyApplicationSecureFileOwner(input.principal),
      actor: bindTrustedCompanyApplicationAuditActor(input.principal),
      fileRef: input.fileRef
    });
  }

  private async scheduleForAuthority(input: {
    owner: TrustedSecureFileOwner;
    actor: TrustedAuditActor;
    fileRef: string;
  }): Promise<SecureFileScanScheduleResult> {
    const database = await this.clientPromise;
    const actor = input.actor;
    return database.transaction(async (transaction) => {
      await assertLiveOwner(transaction, input.owner);
      const locked = await transaction.query<ScanRow>(
        SECURE_FILE_SCAN_OWNER_LOCK_SQL,
        ownerParameters(input.fileRef, input.owner)
      );
      const row = locked.rows[0];
      if (!row) throw new SecureFileScanAccessDeniedError();
      const current = scanStateFromRow(row);
      assertScannableState(current);

      if (current.lifecycleStatus === "scan_pending") {
        if (!current.scanJobId || current.scanGeneration < 1) {
          throw new SecureFileScanConflictError();
        }
        return Object.freeze({
          created: false,
          fileRef: current.fileRef,
          generation: current.scanGeneration,
          jobId: current.scanJobId
        });
      }
      if (
        current.lifecycleStatus !== "quarantined" &&
        current.lifecycleStatus !== "scan_failed"
      ) {
        throw new SecureFileScanConflictError();
      }

      const generation = current.lifecycleStatus === "quarantined"
        ? 1
        : normalizeSecureFileScanGeneration(current.scanGeneration + 1);
      if (current.lifecycleStatus === "quarantined" && current.scanGeneration !== 0) {
        throw new SecureFileScanConflictError();
      }
      const contentSha256 = current.contentSha256;
      if (!contentSha256) throw new SecureFileScanConflictError();

      const outbox = new DatabaseOutboxRepository(Promise.resolve(transaction));
      const job = await outbox.enqueueInTransaction(transaction, actor, {
        jobType: SECURE_FILE_SCAN_JOB_TYPE,
        businessKey: deriveSecureFileScanBusinessKey({
          fileRef: current.fileRef,
          contentSha256,
          generation
        }),
        payload: { fileRef: current.fileRef, generation }
      });

      const updated = await transaction.query<ScanRow>(
        SECURE_FILE_SCAN_MARK_PENDING_SQL,
        [
          ...ownerParameters(current.fileRef, input.owner),
          generation,
          job.jobId,
          current.lifecycleStatus
        ]
      );
      const updatedRow = updated.rows[0];
      if (!updatedRow) throw new SecureFileScanConflictError();
      const pending = scanStateFromRow(updatedRow);
      if (
        pending.lifecycleStatus !== "scan_pending" ||
        pending.scanGeneration !== generation ||
        pending.scanJobId !== job.jobId
      ) {
        throw new SecureFileScanConflictError();
      }

      const audit = new DatabaseAuditRepository(Promise.resolve(transaction));
      await audit.append(actor, {
        action: "secure_file.scan.queued",
        outcome: "succeeded",
        target: { type: "secure_file", reference: pending.fileRef },
        metadata: {
          sourceJobId: job.jobId,
          generation,
          byteSize: pending.byteSize
        }
      });

      return Object.freeze({
        created: true,
        fileRef: pending.fileRef,
        generation,
        jobId: job.jobId
      });
    });
  }

  async loadForHandler(
    job: OutboxJobRecord,
    leaseInput: TrustedOutboxLease
  ): Promise<SecureFileScanState> {
    if (job.jobType !== SECURE_FILE_SCAN_JOB_TYPE) {
      throw new SecureFileScanContractError("Unexpected outbox job type.");
    }
    const lease = assertTrustedOutboxLease(leaseInput);
    const payload = normalizeOutboxPayload(SECURE_FILE_SCAN_JOB_TYPE, job.payload);
    const database = await this.clientPromise;
    return database.transaction(async (transaction) => {
      await this.assertActiveLease(transaction, job, lease);
      const locked = await transaction.query<ScanRow>(
        SECURE_FILE_SCAN_HANDLER_LOCK_SQL,
        [
          payload.fileRef,
          payload.generation,
          job.jobId,
          job.enqueuedByAccountId,
          job.enqueuedByRole,
          job.tenantId,
          job.membershipId
        ]
      );
      const row = locked.rows[0];
      if (!row) throw new SecureFileScanAccessDeniedError();
      const file = scanStateFromRow(row);
      assertScannableState(file);
      assertScanJobBinding(job, file);
      return file;
    });
  }

  async finalizeDecision(input: {
    job: OutboxJobRecord;
    lease: TrustedOutboxLease;
    finalStatus: "available" | "unsafe";
    resultCode: string;
  }): Promise<SecureFileScanState> {
    if (input.job.jobType !== SECURE_FILE_SCAN_JOB_TYPE) {
      throw new SecureFileScanContractError("Unexpected outbox job type.");
    }
    const decision = normalizeFinalDecision({
      finalStatus: input.finalStatus,
      resultCode: input.resultCode
    });
    const lease = assertTrustedOutboxLease(input.lease);
    const payload = normalizeOutboxPayload(
      SECURE_FILE_SCAN_JOB_TYPE,
      input.job.payload
    );
    const database = await this.clientPromise;
    return database.transaction(async (transaction) => {
      await this.assertActiveLease(transaction, input.job, lease);
      const locked = await transaction.query<ScanRow>(
        SECURE_FILE_SCAN_HANDLER_LOCK_SQL,
        [
          payload.fileRef,
          payload.generation,
          input.job.jobId,
          input.job.enqueuedByAccountId,
          input.job.enqueuedByRole,
          input.job.tenantId,
          input.job.membershipId
        ]
      );
      const row = locked.rows[0];
      if (!row) throw new SecureFileScanAccessDeniedError();
      const current = scanStateFromRow(row);
      assertScannableState(current);
      assertScanJobBinding(input.job, current);

      if (
        current.lifecycleStatus === decision.finalStatus &&
        current.scanResultCode === decision.resultCode
      ) {
        return current;
      }
      if (current.lifecycleStatus !== "scan_pending") {
        throw new SecureFileScanConflictError();
      }

      const updated = await transaction.query<ScanRow>(
        SECURE_FILE_SCAN_FINALIZE_SQL,
        [
          current.fileRef,
          current.scanGeneration,
          current.scanJobId,
          current.ownerAccountId,
          current.ownerRole,
          current.tenantId,
          current.membershipId,
          decision.finalStatus,
          decision.resultCode
        ]
      );
      const updatedRow = updated.rows[0];
      if (!updatedRow) throw new SecureFileScanConflictError();
      const finalState = scanStateFromRow(updatedRow);
      if (
        finalState.lifecycleStatus !== decision.finalStatus ||
        finalState.scanResultCode !== decision.resultCode ||
        finalState.scanCompletedAt === null
      ) {
        throw new SecureFileScanConflictError();
      }

      const auditActor = bindTrustedSystemAuditActor("outbox-worker", {
        tenantId: finalState.tenantId,
        membershipId: finalState.membershipId
      });
      const audit = new DatabaseAuditRepository(Promise.resolve(transaction));
      await audit.append(auditActor, {
        action: decision.finalStatus === "available"
          ? "secure_file.scan.available"
          : "secure_file.scan.unsafe",
        outcome: "succeeded",
        target: { type: "secure_file", reference: finalState.fileRef },
        metadata: {
          sourceJobId: input.job.jobId,
          generation: finalState.scanGeneration,
          resultCode: finalState.scanResultCode,
          byteSize: finalState.byteSize
        }
      });
      return finalState;
    });
  }

  private async assertActiveLease(
    database: DatabaseClient,
    job: OutboxJobRecord,
    leaseInput: TrustedOutboxLease
  ): Promise<void> {
    const lease = assertTrustedOutboxLease(leaseInput);
    if (job.jobType !== SECURE_FILE_SCAN_JOB_TYPE) {
      throw new SecureFileScanAccessDeniedError();
    }
    const payload = normalizeOutboxPayload(SECURE_FILE_SCAN_JOB_TYPE, job.payload);
    if (
      lease.jobId !== job.jobId ||
      lease.attemptNumber !== job.attemptCount ||
      job.status !== "leased" ||
      job.leaseId !== lease.leaseId ||
      job.workerId !== lease.workerId
    ) {
      throw new SecureFileScanAccessDeniedError();
    }
    const result = await database.query<{ job_id: string }>(
      SECURE_FILE_SCAN_ACTIVE_LEASE_SQL,
      [
        job.jobId,
        lease.leaseId,
        lease.workerId,
        lease.attemptNumber,
        job.enqueuedByAccountId,
        job.enqueuedByRole,
        job.tenantId,
        job.membershipId,
        payload.fileRef,
        payload.generation
      ]
    );
    if (result.rows[0]?.job_id !== job.jobId) {
      throw new SecureFileScanAccessDeniedError();
    }
  }
}
