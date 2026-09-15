import "server-only";

import type { AuthorizationPrincipal } from "../authorization/authorization-context-domain";
import { bindTrustedAuditActor } from "../audit/audit-domain";
import { DatabaseAuditRepository } from "../audit/audit-repository";
import type { DatabaseClient } from "../database/database";
import { getDatabaseClient } from "../database/database";
import {
  buildReleaseReadinessSnapshot,
  type ReleaseHandoverCheck
} from "./production-launch-domain";

const CHECK_NAMES = ["runbook", "support", "alerts", "rollback", "acceptance"] as const;
const CHECK_STATUSES = ["passed", "failed", "pending"] as const;

type CheckName = (typeof CHECK_NAMES)[number];
type CheckStatus = (typeof CHECK_STATUSES)[number];

type HandoverRow = {
  check_name: string;
  status: string;
  revision: number | string;
  updated_by_account_id: string | null;
  updated_at: string | Date;
};

export type PersistedReleaseHandoverCheck = Readonly<{
  name: CheckName;
  status: CheckStatus;
  revision: number;
  updatedByAccountId: string | null;
  updatedAt: string;
}>;

export type PersistedReleaseReadiness = Readonly<{
  status: "ready" | "attention";
  checks: readonly PersistedReleaseHandoverCheck[];
  generatedAt: string;
}>;

export class ReleaseHandoverInputError extends Error {
  constructor(message = "Release handover input is invalid.") {
    super(message);
    this.name = "ReleaseHandoverInputError";
  }
}

export class ReleaseHandoverAccessError extends Error {
  constructor() {
    super("Release handover access is denied.");
    this.name = "ReleaseHandoverAccessError";
  }
}

export class ReleaseHandoverConflictError extends Error {
  constructor() {
    super("Release handover state changed. Reload and try again.");
    this.name = "ReleaseHandoverConflictError";
  }
}

function isCheckName(value: unknown): value is CheckName {
  return typeof value === "string" && (CHECK_NAMES as readonly string[]).includes(value);
}

function isCheckStatus(value: unknown): value is CheckStatus {
  return typeof value === "string" && (CHECK_STATUSES as readonly string[]).includes(value);
}

function timestamp(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function persistedCheck(row: HandoverRow): PersistedReleaseHandoverCheck {
  if (!isCheckName(row.check_name) || !isCheckStatus(row.status)) {
    throw new Error("Stored release handover state is invalid.");
  }
  const revision = Number(row.revision);
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new Error("Stored release handover revision is invalid.");
  }
  return Object.freeze({
    name: row.check_name,
    status: row.status,
    revision,
    updatedByAccountId: row.updated_by_account_id,
    updatedAt: timestamp(row.updated_at)
  });
}

async function requireLiveAdmin(
  database: DatabaseClient,
  principal: AuthorizationPrincipal,
  now: Date
): Promise<void> {
  if (principal.activeRole !== "admin" || principal.accountStatus !== "active") {
    throw new ReleaseHandoverAccessError();
  }
  const result = await database.query<{ session_id: string }>(
    `SELECT sessions.session_id
     FROM auth_sessions AS sessions
     JOIN auth_accounts AS accounts ON accounts.account_id = sessions.account_id
     JOIN auth_account_roles AS roles
       ON roles.account_id = accounts.account_id
      AND roles.role = 'admin'
     WHERE sessions.session_id = $1
       AND sessions.account_id = $2
       AND sessions.active_role = 'admin'
       AND sessions.revoked_at IS NULL
       AND sessions.expires_at > $3::timestamptz
       AND accounts.account_status = 'active'
     FOR UPDATE OF sessions, accounts`,
    [principal.sessionId, principal.accountId, now.toISOString()]
  );
  if (!result.rows[0]) throw new ReleaseHandoverAccessError();
}

async function readPersistedReadiness(database: DatabaseClient): Promise<PersistedReleaseReadiness> {
  const result = await database.query<HandoverRow>(
    `SELECT check_name, status, revision, updated_by_account_id, updated_at
     FROM production_release_handover_checks
     ORDER BY CASE check_name
       WHEN 'runbook' THEN 1
       WHEN 'support' THEN 2
       WHEN 'alerts' THEN 3
       WHEN 'rollback' THEN 4
       WHEN 'acceptance' THEN 5
       ELSE 6
     END`
  );
  const checks = result.rows.map(persistedCheck);
  const release = buildReleaseReadinessSnapshot(
    checks.map(({ name, status }) => ({ name, status } satisfies ReleaseHandoverCheck))
  );
  return Object.freeze({
    status: release.status,
    checks: Object.freeze(checks),
    generatedAt: release.generatedAt
  });
}

function validateUpdateInput(input: {
  name: unknown;
  status: unknown;
  expectedRevision: unknown;
}): { name: CheckName; status: CheckStatus; expectedRevision: number } {
  if (
    !isCheckName(input.name) ||
    !isCheckStatus(input.status) ||
    !Number.isSafeInteger(input.expectedRevision) ||
    Number(input.expectedRevision) < 0
  ) {
    throw new ReleaseHandoverInputError();
  }
  return {
    name: input.name,
    status: input.status,
    expectedRevision: Number(input.expectedRevision)
  };
}

export class ProductionLaunchService {
  constructor(private readonly database: DatabaseClient) {}

  async getReadiness(
    principal: AuthorizationPrincipal,
    now = new Date()
  ): Promise<PersistedReleaseReadiness> {
    return this.database.transaction(async (database) => {
      await requireLiveAdmin(database, principal, now);
      return readPersistedReadiness(database);
    });
  }

  async updateCheck(
    principal: AuthorizationPrincipal,
    input: { name: unknown; status: unknown; expectedRevision: unknown },
    now = new Date()
  ): Promise<PersistedReleaseReadiness> {
    const update = validateUpdateInput(input);
    return this.database.transaction(async (database) => {
      await requireLiveAdmin(database, principal, now);
      const result = await database.query<HandoverRow>(
        `UPDATE production_release_handover_checks
         SET status = $2,
             revision = revision + 1,
             updated_by_account_id = $3,
             updated_at = $4::timestamptz
         WHERE check_name = $1
           AND revision = $5
         RETURNING check_name, status, revision, updated_by_account_id, updated_at`,
        [update.name, update.status, principal.accountId, now.toISOString(), update.expectedRevision]
      );
      const changed = result.rows[0];
      if (!changed) throw new ReleaseHandoverConflictError();

      const persisted = persistedCheck(changed);
      await new DatabaseAuditRepository(Promise.resolve(database)).append(
        bindTrustedAuditActor(principal),
        {
          action: "production_launch.handover.updated",
          outcome: "succeeded",
          target: { type: "platform", reference: persisted.name },
          metadata: {
            status: persisted.status,
            revision: persisted.revision
          }
        }
      );
      return readPersistedReadiness(database);
    });
  }
}

export async function getProductionLaunchService(): Promise<ProductionLaunchService> {
  return new ProductionLaunchService(await getDatabaseClient());
}
