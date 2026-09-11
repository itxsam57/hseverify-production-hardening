import "server-only";

import type { AuthRole } from "../auth/auth-domain";
import type { AuthorizationPrincipal } from "../authorization/authorization-context-domain";
import {
  requireCurrentTenantPermission,
  requirePlatformPermission
} from "../authorization/authorization-service";
import {
  bindPlatformAuditReadPrincipal,
  bindTrustedAuditActor
} from "../audit/audit-domain";
import type { DatabaseClient } from "../database/database";
import { getDatabaseClient } from "../database/database";
import {
  type EnqueueOutboxJobInput,
  type OutboxAttemptRecord,
  type OutboxJobRecord,
  type OutboxJobType
} from "./outbox-domain";
import { runRequiredOutboxTransactionCore } from "./outbox-transaction-domain";
import {
  DatabaseOutboxRepository,
  getOutboxRepository,
  type OutboxQueryOptions,
  type OutboxRepository
} from "./outbox-repository";

export async function runRequiredOutboxTransaction<Result>(input: {
  principal: AuthorizationPrincipal;
  operation: (context: {
    database: DatabaseClient;
    enqueueRequired<T extends OutboxJobType>(
      job: EnqueueOutboxJobInput<T>
    ): Promise<OutboxJobRecord>;
  }) => Promise<Result>;
  database?: DatabaseClient;
  repository?: OutboxRepository;
}): Promise<Result> {
  const actor = bindTrustedAuditActor(input.principal);
  const database = input.database ?? await getDatabaseClient();
  const repository = input.repository
    ?? new DatabaseOutboxRepository(Promise.resolve(database));

  return runRequiredOutboxTransactionCore({
    executor: database,
    actor,
    enqueue: (transaction, trustedActor, job) =>
      repository.enqueueInTransaction(
        transaction,
        trustedActor,
        job
      ),
    operation: ({ transaction, enqueueRequired }) =>
      input.operation({
        database: transaction,
        enqueueRequired
      })
  });
}

export async function listAuthorizedPlatformOutboxJobs(input: {
  expectedRole: Extract<AuthRole, "admin" | "root">;
  options?: OutboxQueryOptions;
  repository?: OutboxRepository;
}): Promise<readonly OutboxJobRecord[]> {
  const principal = await requirePlatformPermission({
    expectedRole: input.expectedRole,
    permission: "platform.security.read"
  });
  return (input.repository ?? getOutboxRepository()).listPlatform(
    bindPlatformAuditReadPrincipal(principal),
    input.options
  );
}

export async function findAuthorizedPlatformOutboxJob(input: {
  expectedRole: Extract<AuthRole, "admin" | "root">;
  jobId: string;
  repository?: OutboxRepository;
}): Promise<OutboxJobRecord | null> {
  const principal = await requirePlatformPermission({
    expectedRole: input.expectedRole,
    permission: "platform.security.read"
  });
  return (input.repository ?? getOutboxRepository()).findPlatformById(
    bindPlatformAuditReadPrincipal(principal),
    input.jobId
  );
}

export async function listAuthorizedPlatformOutboxAttempts(input: {
  expectedRole: Extract<AuthRole, "admin" | "root">;
  jobId: string;
  limit?: number;
  repository?: OutboxRepository;
}): Promise<readonly OutboxAttemptRecord[]> {
  const principal = await requirePlatformPermission({
    expectedRole: input.expectedRole,
    permission: "platform.security.read"
  });
  return (input.repository ?? getOutboxRepository()).listPlatformAttempts(
    bindPlatformAuditReadPrincipal(principal),
    input.jobId,
    input.limit
  );
}

export async function listCurrentTenantOutboxJobs(input?: {
  options?: OutboxQueryOptions;
  repository?: OutboxRepository;
}): Promise<readonly OutboxJobRecord[]> {
  const principal = await requireCurrentTenantPermission("company.audit.read");
  return (input?.repository ?? getOutboxRepository()).listTenant(
    principal,
    input?.options
  );
}

export async function findCurrentTenantOutboxJob(input: {
  jobId: string;
  repository?: OutboxRepository;
}): Promise<OutboxJobRecord | null> {
  const principal = await requireCurrentTenantPermission("company.audit.read");
  return (input.repository ?? getOutboxRepository()).findTenantById(
    principal,
    input.jobId
  );
}

export async function listCurrentTenantOutboxAttempts(input: {
  jobId: string;
  limit?: number;
  repository?: OutboxRepository;
}): Promise<readonly OutboxAttemptRecord[]> {
  const principal = await requireCurrentTenantPermission("company.audit.read");
  return (input.repository ?? getOutboxRepository()).listTenantAttempts(
    principal,
    input.jobId,
    input.limit
  );
}
