"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DatabaseOutboxRepository = exports.OUTBOX_TENANT_ATTEMPTS_SQL = exports.OUTBOX_PLATFORM_ATTEMPTS_SQL = exports.OUTBOX_TENANT_FIND_SQL = exports.OUTBOX_TENANT_LIST_SQL = exports.OUTBOX_PLATFORM_FIND_SQL = exports.OUTBOX_PLATFORM_LIST_SQL = exports.OUTBOX_PLATFORM_READ_GUARD_SQL = exports.OUTBOX_TERMINAL_ATTEMPT_SQL = exports.OUTBOX_TERMINAL_EXPIRED_JOB_SQL = exports.OUTBOX_TERMINAL_JOB_SQL = exports.OUTBOX_RETRY_ATTEMPT_SQL = exports.OUTBOX_RETRY_JOB_SQL = exports.OUTBOX_SUCCEED_ATTEMPT_SQL = exports.OUTBOX_SUCCEED_JOB_SQL = exports.OUTBOX_INSERT_ATTEMPT_SQL = exports.OUTBOX_LEASE_JOB_SQL = exports.OUTBOX_MARK_EXPIRED_ATTEMPT_SQL = exports.OUTBOX_CLAIM_CANDIDATE_SQL = exports.OUTBOX_FIND_DEDUPLICATED_SQL = exports.OUTBOX_ENQUEUE_SQL = void 0;
exports.getOutboxRepository = getOutboxRepository;
const database_1 = require("../database/database");
const tenant_scoped_command_guard_1 = require("../authorization/tenant-scoped-command-guard");
const audit_domain_1 = require("../audit/audit-domain");
const audit_repository_1 = require("../audit/audit-repository");
const outbox_domain_1 = require("./outbox-domain");
exports.OUTBOX_ENQUEUE_SQL = `
INSERT INTO platform_outbox_jobs (
  job_id, job_type, schema_version, idempotency_key, payload,
  enqueued_by_account_id, enqueued_by_role, tenant_id, membership_id
) VALUES (
  $1, $2, $3, $4, $5::jsonb,
  $6, $7, $8, $9
)
ON CONFLICT (job_type, idempotency_key) DO NOTHING
RETURNING *`;
exports.OUTBOX_FIND_DEDUPLICATED_SQL = `
SELECT *
FROM platform_outbox_jobs
WHERE job_type = $1
  AND idempotency_key = $2`;
exports.OUTBOX_CLAIM_CANDIDATE_SQL = `
SELECT *
FROM platform_outbox_jobs
WHERE (
    status IN ('pending', 'retry_wait')
    AND next_attempt_at <= CURRENT_TIMESTAMP
  ) OR (
    status = 'leased'
    AND lease_expires_at <= CURRENT_TIMESTAMP
  )
ORDER BY
  CASE WHEN status = 'leased' THEN 0 ELSE 1 END,
  COALESCE(lease_expires_at, next_attempt_at),
  job_sequence
FOR UPDATE SKIP LOCKED
LIMIT 1`;
exports.OUTBOX_MARK_EXPIRED_ATTEMPT_SQL = `
UPDATE platform_outbox_job_attempts
SET outcome = $3,
    error_code = $4,
    error_summary = $5,
    finished_at = CURRENT_TIMESTAMP,
    next_attempt_at = NULL
WHERE job_id = $1
  AND lease_id = $2
  AND outcome = 'running'
RETURNING *`;
exports.OUTBOX_LEASE_JOB_SQL = `
UPDATE platform_outbox_jobs
SET status = 'leased',
    attempt_count = attempt_count + 1,
    lease_id = $2,
    worker_id = $3,
    lease_expires_at = CURRENT_TIMESTAMP
      + ($4::integer * INTERVAL '1 second'),
    updated_at = CURRENT_TIMESTAMP
WHERE job_id = $1
  AND attempt_count < max_attempts
  AND (
    (status IN ('pending', 'retry_wait') AND next_attempt_at <= CURRENT_TIMESTAMP)
    OR (status = 'leased' AND lease_expires_at <= CURRENT_TIMESTAMP)
  )
RETURNING *`;
exports.OUTBOX_INSERT_ATTEMPT_SQL = `
INSERT INTO platform_outbox_job_attempts (
  attempt_id, job_id, attempt_number, worker_id, lease_id, outcome
) VALUES ($1, $2, $3, $4, $5, 'running')
RETURNING *`;
exports.OUTBOX_SUCCEED_JOB_SQL = `
UPDATE platform_outbox_jobs
SET status = 'succeeded',
    lease_id = NULL,
    worker_id = NULL,
    lease_expires_at = NULL,
    succeeded_at = CURRENT_TIMESTAMP,
    last_error_code = NULL,
    last_error_summary = NULL,
    updated_at = CURRENT_TIMESTAMP
WHERE job_id = $1
  AND status = 'leased'
  AND lease_id = $2
  AND worker_id = $3
  AND lease_expires_at > CURRENT_TIMESTAMP
RETURNING *`;
exports.OUTBOX_SUCCEED_ATTEMPT_SQL = `
UPDATE platform_outbox_job_attempts
SET outcome = 'succeeded',
    finished_at = CURRENT_TIMESTAMP
WHERE attempt_id = $1
  AND job_id = $2
  AND lease_id = $3
  AND worker_id = $4
  AND outcome = 'running'
RETURNING *`;
exports.OUTBOX_RETRY_JOB_SQL = `
UPDATE platform_outbox_jobs
SET status = 'retry_wait',
    lease_id = NULL,
    worker_id = NULL,
    lease_expires_at = NULL,
    next_attempt_at = CURRENT_TIMESTAMP
      + ($4::integer * INTERVAL '1 second'),
    last_error_code = $5,
    last_error_summary = $6,
    updated_at = CURRENT_TIMESTAMP
WHERE job_id = $1
  AND status = 'leased'
  AND lease_id = $2
  AND worker_id = $3
  AND lease_expires_at > CURRENT_TIMESTAMP
  AND attempt_count < max_attempts
RETURNING *`;
exports.OUTBOX_RETRY_ATTEMPT_SQL = `
UPDATE platform_outbox_job_attempts
SET outcome = 'retry_scheduled',
    error_code = $5,
    error_summary = $6,
    finished_at = CURRENT_TIMESTAMP,
    next_attempt_at = CURRENT_TIMESTAMP
      + ($4::integer * INTERVAL '1 second')
WHERE attempt_id = $1
  AND job_id = $2
  AND lease_id = $3
  AND outcome = 'running'
RETURNING *`;
exports.OUTBOX_TERMINAL_JOB_SQL = `
UPDATE platform_outbox_jobs
SET status = 'terminal_failed',
    lease_id = NULL,
    worker_id = NULL,
    lease_expires_at = NULL,
    terminal_failed_at = CURRENT_TIMESTAMP,
    last_error_code = $4,
    last_error_summary = $5,
    updated_at = CURRENT_TIMESTAMP
WHERE job_id = $1
  AND status = 'leased'
  AND lease_id = $2
  AND worker_id = $3
  AND lease_expires_at > CURRENT_TIMESTAMP
RETURNING *`;
exports.OUTBOX_TERMINAL_EXPIRED_JOB_SQL = `
UPDATE platform_outbox_jobs
SET status = 'terminal_failed',
    lease_id = NULL,
    worker_id = NULL,
    lease_expires_at = NULL,
    terminal_failed_at = CURRENT_TIMESTAMP,
    last_error_code = $2,
    last_error_summary = $3,
    updated_at = CURRENT_TIMESTAMP
WHERE job_id = $1
  AND status = 'leased'
  AND lease_expires_at <= CURRENT_TIMESTAMP
  AND attempt_count >= max_attempts
RETURNING *`;
exports.OUTBOX_TERMINAL_ATTEMPT_SQL = `
UPDATE platform_outbox_job_attempts
SET outcome = 'terminal_failed',
    error_code = $5,
    error_summary = $6,
    finished_at = CURRENT_TIMESTAMP,
    next_attempt_at = NULL
WHERE attempt_id = $1
  AND job_id = $2
  AND lease_id = $3
  AND worker_id = $4
  AND outcome = 'running'
RETURNING *`;
exports.OUTBOX_PLATFORM_READ_GUARD_SQL = `
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
  AND sessions.expires_at > CURRENT_TIMESTAMP
FOR UPDATE OF sessions, accounts`;
exports.OUTBOX_PLATFORM_LIST_SQL = `
SELECT *
FROM platform_outbox_jobs
WHERE ($1::bigint IS NULL OR job_sequence < $1::bigint)
ORDER BY job_sequence DESC
LIMIT $2`;
exports.OUTBOX_PLATFORM_FIND_SQL = `
SELECT *
FROM platform_outbox_jobs
WHERE job_id = $1`;
exports.OUTBOX_TENANT_LIST_SQL = `
SELECT *
FROM platform_outbox_jobs
WHERE tenant_id = $1
  AND ($2::bigint IS NULL OR job_sequence < $2::bigint)
ORDER BY job_sequence DESC
LIMIT $3`;
exports.OUTBOX_TENANT_FIND_SQL = `
SELECT *
FROM platform_outbox_jobs
WHERE tenant_id = $1
  AND job_id = $2`;
exports.OUTBOX_PLATFORM_ATTEMPTS_SQL = `
SELECT attempts.*
FROM platform_outbox_job_attempts AS attempts
JOIN platform_outbox_jobs AS jobs
  ON jobs.job_id = attempts.job_id
WHERE attempts.job_id = $1
ORDER BY attempts.attempt_number DESC
LIMIT $2`;
exports.OUTBOX_TENANT_ATTEMPTS_SQL = `
SELECT attempts.*
FROM platform_outbox_job_attempts AS attempts
JOIN platform_outbox_jobs AS jobs
  ON jobs.job_id = attempts.job_id
WHERE jobs.tenant_id = $1
  AND attempts.job_id = $2
ORDER BY attempts.attempt_number DESC
LIMIT $3`;
function timestamp(value) {
    return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
function optionalTimestamp(value) {
    return value === null ? null : timestamp(value);
}
function parsePayload(value) {
    return typeof value === "string" ? JSON.parse(value) : value;
}
function jobFromRow(row) {
    if (!(0, outbox_domain_1.isOutboxJobType)(row.job_type) ||
        !(0, outbox_domain_1.isOutboxJobStatus)(row.status) ||
        Number(row.schema_version) !== outbox_domain_1.OUTBOX_SCHEMA_VERSION ||
        Number(row.max_attempts) !== outbox_domain_1.OUTBOX_MAX_ATTEMPTS) {
        throw new outbox_domain_1.OutboxContractError("Stored outbox job vocabulary is invalid.");
    }
    return Object.freeze({
        sequence: Number(row.job_sequence),
        jobId: row.job_id,
        jobType: row.job_type,
        schemaVersion: outbox_domain_1.OUTBOX_SCHEMA_VERSION,
        idempotencyKey: row.idempotency_key,
        payload: (0, outbox_domain_1.normalizeOutboxPayload)(row.job_type, parsePayload(row.payload)),
        enqueuedByAccountId: row.enqueued_by_account_id,
        enqueuedByRole: row.enqueued_by_role,
        tenantId: row.tenant_id,
        membershipId: row.membership_id,
        status: row.status,
        attemptCount: Number(row.attempt_count),
        maxAttempts: outbox_domain_1.OUTBOX_MAX_ATTEMPTS,
        nextAttemptAt: timestamp(row.next_attempt_at),
        leaseId: row.lease_id,
        workerId: row.worker_id,
        leaseExpiresAt: optionalTimestamp(row.lease_expires_at),
        succeededAt: optionalTimestamp(row.succeeded_at),
        terminalFailedAt: optionalTimestamp(row.terminal_failed_at),
        lastErrorCode: row.last_error_code,
        lastErrorSummary: row.last_error_summary,
        createdAt: timestamp(row.created_at),
        updatedAt: timestamp(row.updated_at)
    });
}
function attemptFromRow(row) {
    if (!(0, outbox_domain_1.isOutboxAttemptOutcome)(row.outcome)) {
        throw new outbox_domain_1.OutboxContractError("Stored outbox attempt outcome is invalid.");
    }
    return Object.freeze({
        sequence: Number(row.attempt_sequence),
        attemptId: row.attempt_id,
        jobId: row.job_id,
        attemptNumber: Number(row.attempt_number),
        workerId: row.worker_id,
        leaseId: row.lease_id,
        outcome: row.outcome,
        errorCode: row.error_code,
        errorSummary: row.error_summary,
        startedAt: timestamp(row.started_at),
        finishedAt: optionalTimestamp(row.finished_at),
        nextAttemptAt: optionalTimestamp(row.next_attempt_at)
    });
}
async function appendLifecycleAudit(input) {
    const audit = new audit_repository_1.DatabaseAuditRepository(Promise.resolve(input.database));
    await audit.append(input.actor, {
        action: input.action,
        outcome: input.outcome,
        reason: input.reason ?? null,
        target: { type: "job", reference: input.job.jobId },
        metadata: {
            jobType: input.job.jobType,
            attemptCount: input.job.attemptCount,
            ...input.metadata
        }
    });
}
class DatabaseOutboxRepository {
    clientPromise;
    constructor(clientPromise = (0, database_1.getDatabaseClient)()) {
        this.clientPromise = clientPromise;
    }
    client() {
        return this.clientPromise;
    }
    async enqueueInTransaction(database, actorInput, input) {
        const actor = (0, outbox_domain_1.assertOutboxEnqueueActor)(actorInput);
        if (!(0, outbox_domain_1.isOutboxJobType)(input.jobType)) {
            throw new outbox_domain_1.OutboxContractError("Unknown outbox job type.");
        }
        const payload = (0, outbox_domain_1.normalizeOutboxPayload)(input.jobType, input.payload);
        const idempotencyKey = (0, outbox_domain_1.deriveOutboxIdempotencyKey)(input.jobType, input.businessKey, actor.tenantId === null
            ? `account:${actor.accountId}`
            : `tenant:${actor.tenantId}`);
        const inserted = await database.query(exports.OUTBOX_ENQUEUE_SQL, [
            (0, outbox_domain_1.createOutboxJobId)(),
            input.jobType,
            outbox_domain_1.OUTBOX_SCHEMA_VERSION,
            idempotencyKey,
            JSON.stringify(payload),
            actor.accountId,
            actor.activeRole,
            actor.tenantId,
            actor.membershipId
        ]);
        let created = true;
        let row = inserted.rows[0];
        if (!row) {
            created = false;
            const existing = await database.query(exports.OUTBOX_FIND_DEDUPLICATED_SQL, [input.jobType, idempotencyKey]);
            row = existing.rows[0];
            if (!row) {
                throw new outbox_domain_1.OutboxContractError("Deduplicated outbox job was not found.");
            }
        }
        const job = jobFromRow(row);
        if (job.jobType !== input.jobType ||
            JSON.stringify(job.payload) !== JSON.stringify(payload) ||
            job.enqueuedByAccountId !== actor.accountId ||
            job.enqueuedByRole !== actor.activeRole ||
            job.tenantId !== actor.tenantId ||
            job.membershipId !== actor.membershipId) {
            throw new outbox_domain_1.OutboxContractError("Outbox idempotency key resolved inconsistently.");
        }
        if (created) {
            await appendLifecycleAudit({
                database,
                actor,
                action: "outbox.job.enqueued",
                outcome: "succeeded",
                job,
                metadata: { schemaVersion: outbox_domain_1.OUTBOX_SCHEMA_VERSION }
            });
        }
        return job;
    }
    async claimNext(workerInput) {
        const worker = (0, outbox_domain_1.assertTrustedOutboxWorker)(workerInput);
        const database = await this.client();
        return database.transaction(async (transaction) => {
            while (true) {
                const candidateResult = await transaction.query(exports.OUTBOX_CLAIM_CANDIDATE_SQL);
                const candidateRow = candidateResult.rows[0];
                if (!candidateRow)
                    return null;
                const candidate = jobFromRow(candidateRow);
                if (candidate.status === "leased") {
                    const expiredFailure = (0, outbox_domain_1.normalizeOutboxFailure)({
                        code: candidate.attemptCount >= candidate.maxAttempts
                            ? "lease_expired_max_attempts"
                            : "lease_expired",
                        summary: candidate.attemptCount >= candidate.maxAttempts
                            ? "The final worker lease expired before completion."
                            : "The worker lease expired before completion."
                    });
                    const expiredAttempt = await transaction.query(exports.OUTBOX_MARK_EXPIRED_ATTEMPT_SQL, [
                        candidate.jobId,
                        candidate.leaseId,
                        candidate.attemptCount >= candidate.maxAttempts
                            ? "terminal_failed"
                            : "lease_expired",
                        expiredFailure.code,
                        expiredFailure.summary
                    ]);
                    if (!expiredAttempt.rows[0]) {
                        throw new outbox_domain_1.OutboxContractError("Expired outbox attempt was not finalized.");
                    }
                    if (candidate.attemptCount >= candidate.maxAttempts) {
                        const terminal = await transaction.query(exports.OUTBOX_TERMINAL_EXPIRED_JOB_SQL, [
                            candidate.jobId,
                            expiredFailure.code,
                            expiredFailure.summary
                        ]);
                        const terminalRow = terminal.rows[0];
                        if (!terminalRow) {
                            throw new outbox_domain_1.OutboxContractError("Expired final outbox job was not terminalized.");
                        }
                        const terminalJob = jobFromRow(terminalRow);
                        await appendLifecycleAudit({
                            database: transaction,
                            actor: (0, audit_domain_1.bindTrustedSystemAuditActor)("outbox-worker", {
                                tenantId: terminalJob.tenantId,
                                membershipId: terminalJob.membershipId
                            }),
                            action: "outbox.job.terminal_failed",
                            outcome: "failed",
                            reason: expiredFailure.code,
                            job: terminalJob,
                            metadata: { cause: "lease_expiry" }
                        });
                        continue;
                    }
                    await appendLifecycleAudit({
                        database: transaction,
                        actor: (0, audit_domain_1.bindTrustedSystemAuditActor)("outbox-worker", {
                            tenantId: candidate.tenantId,
                            membershipId: candidate.membershipId
                        }),
                        action: "outbox.job.lease_reclaimed",
                        outcome: "succeeded",
                        reason: "lease_expired",
                        job: candidate,
                        metadata: { previousAttempt: candidate.attemptCount }
                    });
                }
                const leaseId = (0, outbox_domain_1.createOutboxLeaseId)();
                const leased = await transaction.query(exports.OUTBOX_LEASE_JOB_SQL, [
                    candidate.jobId,
                    leaseId,
                    worker.workerId,
                    outbox_domain_1.OUTBOX_LEASE_SECONDS
                ]);
                const leasedRow = leased.rows[0];
                if (!leasedRow)
                    continue;
                const job = jobFromRow(leasedRow);
                const attemptId = (0, outbox_domain_1.createOutboxAttemptId)();
                const attempt = await transaction.query(exports.OUTBOX_INSERT_ATTEMPT_SQL, [
                    attemptId,
                    job.jobId,
                    job.attemptCount,
                    worker.workerId,
                    leaseId
                ]);
                if (!attempt.rows[0] || !job.leaseExpiresAt) {
                    throw new outbox_domain_1.OutboxContractError("Outbox attempt was not persisted.");
                }
                await appendLifecycleAudit({
                    database: transaction,
                    actor: (0, audit_domain_1.bindTrustedSystemAuditActor)("outbox-worker", {
                        tenantId: job.tenantId,
                        membershipId: job.membershipId
                    }),
                    action: "outbox.job.claimed",
                    outcome: "succeeded",
                    job,
                    metadata: {
                        attemptNumber: job.attemptCount,
                        workerRef: worker.workerId
                    }
                });
                return Object.freeze({
                    job,
                    lease: (0, outbox_domain_1.createTrustedOutboxLease)({
                        jobId: job.jobId,
                        attemptId,
                        attemptNumber: job.attemptCount,
                        workerId: worker.workerId,
                        leaseId,
                        leaseExpiresAt: job.leaseExpiresAt
                    })
                });
            }
        });
    }
    async succeed(leaseInput) {
        const lease = (0, outbox_domain_1.assertTrustedOutboxLease)(leaseInput);
        const database = await this.client();
        return database.transaction(async (transaction) => {
            const succeeded = await transaction.query(exports.OUTBOX_SUCCEED_JOB_SQL, [lease.jobId, lease.leaseId, lease.workerId]);
            const row = succeeded.rows[0];
            if (!row)
                throw new outbox_domain_1.StaleOutboxLeaseError();
            const attempt = await transaction.query(exports.OUTBOX_SUCCEED_ATTEMPT_SQL, [lease.attemptId, lease.jobId, lease.leaseId, lease.workerId]);
            if (!attempt.rows[0])
                throw new outbox_domain_1.StaleOutboxLeaseError();
            const job = jobFromRow(row);
            await appendLifecycleAudit({
                database: transaction,
                actor: (0, audit_domain_1.bindTrustedSystemAuditActor)("outbox-worker", {
                    tenantId: job.tenantId,
                    membershipId: job.membershipId
                }),
                action: "outbox.job.succeeded",
                outcome: "succeeded",
                job,
                metadata: { attemptNumber: lease.attemptNumber }
            });
            return job;
        });
    }
    async retry(leaseInput, failureInput) {
        const lease = (0, outbox_domain_1.assertTrustedOutboxLease)(leaseInput);
        const failure = (0, outbox_domain_1.normalizeOutboxFailure)(failureInput);
        if (lease.attemptNumber >= outbox_domain_1.OUTBOX_MAX_ATTEMPTS) {
            return this.terminalFail(lease, failure);
        }
        const delay = (0, outbox_domain_1.retryDelaySeconds)(lease.attemptNumber);
        const database = await this.client();
        return database.transaction(async (transaction) => {
            const retried = await transaction.query(exports.OUTBOX_RETRY_JOB_SQL, [
                lease.jobId,
                lease.leaseId,
                lease.workerId,
                delay,
                failure.code,
                failure.summary
            ]);
            const row = retried.rows[0];
            if (!row)
                throw new outbox_domain_1.StaleOutboxLeaseError();
            const attempt = await transaction.query(exports.OUTBOX_RETRY_ATTEMPT_SQL, [
                lease.attemptId,
                lease.jobId,
                lease.leaseId,
                delay,
                failure.code,
                failure.summary
            ]);
            if (!attempt.rows[0])
                throw new outbox_domain_1.StaleOutboxLeaseError();
            const job = jobFromRow(row);
            await appendLifecycleAudit({
                database: transaction,
                actor: (0, audit_domain_1.bindTrustedSystemAuditActor)("outbox-worker", {
                    tenantId: job.tenantId,
                    membershipId: job.membershipId
                }),
                action: "outbox.job.retry_scheduled",
                outcome: "failed",
                reason: failure.code,
                job,
                metadata: {
                    attemptNumber: lease.attemptNumber,
                    backoffSeconds: delay
                }
            });
            return job;
        });
    }
    async terminalFail(leaseInput, failureInput) {
        const lease = (0, outbox_domain_1.assertTrustedOutboxLease)(leaseInput);
        const failure = (0, outbox_domain_1.normalizeOutboxFailure)(failureInput);
        const database = await this.client();
        return database.transaction(async (transaction) => {
            const failed = await transaction.query(exports.OUTBOX_TERMINAL_JOB_SQL, [
                lease.jobId,
                lease.leaseId,
                lease.workerId,
                failure.code,
                failure.summary
            ]);
            const row = failed.rows[0];
            if (!row)
                throw new outbox_domain_1.StaleOutboxLeaseError();
            const attempt = await transaction.query(exports.OUTBOX_TERMINAL_ATTEMPT_SQL, [
                lease.attemptId,
                lease.jobId,
                lease.leaseId,
                lease.workerId,
                failure.code,
                failure.summary
            ]);
            if (!attempt.rows[0])
                throw new outbox_domain_1.StaleOutboxLeaseError();
            const job = jobFromRow(row);
            await appendLifecycleAudit({
                database: transaction,
                actor: (0, audit_domain_1.bindTrustedSystemAuditActor)("outbox-worker", {
                    tenantId: job.tenantId,
                    membershipId: job.membershipId
                }),
                action: "outbox.job.terminal_failed",
                outcome: "failed",
                reason: failure.code,
                job,
                metadata: { attemptNumber: lease.attemptNumber }
            });
            return job;
        });
    }
    async platformRead(principal, operation) {
        const scope = (0, audit_domain_1.derivePlatformAuditReadScope)(principal);
        const database = await this.client();
        return database.transaction(async (transaction) => {
            const guard = await transaction.query(exports.OUTBOX_PLATFORM_READ_GUARD_SQL, [scope.sessionId, scope.accountId, scope.activeRole]);
            if (guard.rows[0]?.session_id !== scope.sessionId) {
                throw new audit_domain_1.AuditReadDeniedError();
            }
            return operation(transaction);
        });
    }
    async listPlatform(principal, options = {}) {
        const cursor = (0, outbox_domain_1.normalizeOutboxCursor)(options.beforeSequence);
        const limit = (0, outbox_domain_1.normalizeOutboxLimit)(options.limit);
        return this.platformRead(principal, async (database) => {
            const result = await database.query(exports.OUTBOX_PLATFORM_LIST_SQL, [cursor, limit]);
            return Object.freeze(result.rows.map(jobFromRow));
        });
    }
    async findPlatformById(principal, jobId) {
        const normalizedJobId = (0, outbox_domain_1.normalizeOutboxJobReference)(jobId);
        if (normalizedJobId === null)
            return null;
        return this.platformRead(principal, async (database) => {
            const result = await database.query(exports.OUTBOX_PLATFORM_FIND_SQL, [normalizedJobId]);
            return result.rows[0] ? jobFromRow(result.rows[0]) : null;
        });
    }
    async listTenant(principal, options = {}) {
        const cursor = (0, outbox_domain_1.normalizeOutboxCursor)(options.beforeSequence);
        const limit = (0, outbox_domain_1.normalizeOutboxLimit)(options.limit);
        return (0, tenant_scoped_command_guard_1.runTenantScopedCommand)({
            database: await this.client(),
            principal,
            permission: "company.audit.read",
            operation: async ({ database, scope }) => {
                const result = await database.query(exports.OUTBOX_TENANT_LIST_SQL, [scope.tenantId, cursor, limit]);
                return Object.freeze(result.rows.map(jobFromRow));
            }
        });
    }
    async findTenantById(principal, jobId) {
        const normalizedJobId = (0, outbox_domain_1.normalizeOutboxJobReference)(jobId);
        if (normalizedJobId === null)
            return null;
        return (0, tenant_scoped_command_guard_1.runTenantScopedCommand)({
            database: await this.client(),
            principal,
            permission: "company.audit.read",
            operation: async ({ database, scope }) => {
                const result = await database.query(exports.OUTBOX_TENANT_FIND_SQL, [scope.tenantId, normalizedJobId]);
                return result.rows[0] ? jobFromRow(result.rows[0]) : null;
            }
        });
    }
    async listPlatformAttempts(principal, jobId, limit) {
        const normalizedJobId = (0, outbox_domain_1.normalizeOutboxJobReference)(jobId);
        if (normalizedJobId === null)
            return Object.freeze([]);
        const normalizedLimit = (0, outbox_domain_1.normalizeOutboxLimit)(limit);
        return this.platformRead(principal, async (database) => {
            const result = await database.query(exports.OUTBOX_PLATFORM_ATTEMPTS_SQL, [normalizedJobId, normalizedLimit]);
            return Object.freeze(result.rows.map(attemptFromRow));
        });
    }
    async listTenantAttempts(principal, jobId, limit) {
        const normalizedJobId = (0, outbox_domain_1.normalizeOutboxJobReference)(jobId);
        if (normalizedJobId === null)
            return Object.freeze([]);
        const normalizedLimit = (0, outbox_domain_1.normalizeOutboxLimit)(limit);
        return (0, tenant_scoped_command_guard_1.runTenantScopedCommand)({
            database: await this.client(),
            principal,
            permission: "company.audit.read",
            operation: async ({ database, scope }) => {
                const result = await database.query(exports.OUTBOX_TENANT_ATTEMPTS_SQL, [scope.tenantId, normalizedJobId, normalizedLimit]);
                return Object.freeze(result.rows.map(attemptFromRow));
            }
        });
    }
}
exports.DatabaseOutboxRepository = DatabaseOutboxRepository;
let repository = null;
function getOutboxRepository() {
    repository ??= new DatabaseOutboxRepository();
    return repository;
}
