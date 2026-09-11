import "server-only";

import type { AuthRole, OtpChannel } from "@/lib/auth/auth-domain";
import {
  AuthenticationRepository,
  type AuthAccount
} from "@/lib/auth/auth-repository";
import {
  getDatabaseClient,
  type DatabaseClient
} from "@/lib/database/database";

type DatabaseTimestamp = string | Date;

type AccessRateLimitAction =
  | "sign_in"
  | "password_reset"
  | "staff_invitation"
  | "root_bootstrap";

export type RecoveryFlow = {
  flowId: string;
  accountId: string;
  activeRole: AuthRole;
  tokenHash: string;
  challengeId: string;
  expiresAt: string;
  consumedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type StaffInvitation = {
  invitationId: string;
  email: string;
  role: Exclude<AuthRole, "worker">;
  tokenHash: string;
  status: "pending" | "accepted" | "revoked" | "expired";
  invitedByAccountId: string | null;
  acceptedByAccountId: string | null;
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
};

export type StaffEnrollmentStep =
  | "profile"
  | "totp"
  | "complete"
  | "cancelled";

export type StaffEnrollmentFlow = {
  flowId: string;
  invitationId: string;
  tokenHash: string;
  accountId: string | null;
  factorId: string | null;
  currentStep: StaffEnrollmentStep;
  expiresAt: string;
  completedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type MfaFactor = {
  factorId: string;
  accountId: string;
  factorType: "totp";
  encryptedSecret: string;
  status: "pending" | "active" | "revoked";
  lastAcceptedCounter: number | null;
  createdAt: string;
  activatedAt: string | null;
  revokedAt: string | null;
};

export type ActiveSessionSummary = {
  sessionId: string;
  activeRole: AuthRole;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
};

type RecoveryFlowRow = {
  flow_id: string;
  account_id: string;
  active_role: AuthRole;
  token_hash: string;
  challenge_id: string;
  expires_at: DatabaseTimestamp;
  consumed_at: DatabaseTimestamp | null;
  created_at: DatabaseTimestamp;
  updated_at: DatabaseTimestamp;
};

type StaffInvitationRow = {
  invitation_id: string;
  email_normalized: string;
  role: Exclude<AuthRole, "worker">;
  token_hash: string;
  invitation_status: StaffInvitation["status"];
  invited_by_account_id: string | null;
  accepted_by_account_id: string | null;
  expires_at: DatabaseTimestamp;
  accepted_at: DatabaseTimestamp | null;
  revoked_at: DatabaseTimestamp | null;
  created_at: DatabaseTimestamp;
};

type StaffEnrollmentFlowRow = {
  flow_id: string;
  invitation_id: string;
  token_hash: string;
  account_id: string | null;
  factor_id: string | null;
  current_step: StaffEnrollmentStep;
  expires_at: DatabaseTimestamp;
  completed_at: DatabaseTimestamp | null;
  cancelled_at: DatabaseTimestamp | null;
  created_at: DatabaseTimestamp;
  updated_at: DatabaseTimestamp;
};

type MfaFactorRow = {
  factor_id: string;
  account_id: string;
  factor_type: "totp";
  encrypted_secret: string;
  factor_status: MfaFactor["status"];
  last_accepted_counter: bigint | number | string | null;
  created_at: DatabaseTimestamp;
  activated_at: DatabaseTimestamp | null;
  revoked_at: DatabaseTimestamp | null;
};

type SessionSummaryRow = {
  session_id: string;
  active_role: AuthRole;
  created_at: DatabaseTimestamp;
  last_seen_at: DatabaseTimestamp;
  expires_at: DatabaseTimestamp;
};

const RECOVERY_COLUMNS = `
  flow_id,
  account_id,
  active_role,
  token_hash,
  challenge_id,
  expires_at,
  consumed_at,
  created_at,
  updated_at
`;

const INVITATION_COLUMNS = `
  invitation_id,
  email_normalized,
  role,
  token_hash,
  invitation_status,
  invited_by_account_id,
  accepted_by_account_id,
  expires_at,
  accepted_at,
  revoked_at,
  created_at
`;

const ENROLLMENT_COLUMNS = `
  flow_id,
  invitation_id,
  token_hash,
  account_id,
  factor_id,
  current_step,
  expires_at,
  completed_at,
  cancelled_at,
  created_at,
  updated_at
`;

const MFA_COLUMNS = `
  factor_id,
  account_id,
  factor_type,
  encrypted_secret,
  factor_status,
  last_accepted_counter,
  created_at,
  activated_at,
  revoked_at
`;

function timestamp(value: DatabaseTimestamp): string {
  return value instanceof Date ? value.toISOString() : value;
}

function nullableTimestamp(value: DatabaseTimestamp | null): string | null {
  return value === null ? null : timestamp(value);
}

function recoveryFromRow(row: RecoveryFlowRow): RecoveryFlow {
  return {
    flowId: row.flow_id,
    accountId: row.account_id,
    activeRole: row.active_role,
    tokenHash: row.token_hash,
    challengeId: row.challenge_id,
    expiresAt: timestamp(row.expires_at),
    consumedAt: nullableTimestamp(row.consumed_at),
    createdAt: timestamp(row.created_at),
    updatedAt: timestamp(row.updated_at)
  };
}

function invitationFromRow(row: StaffInvitationRow): StaffInvitation {
  return {
    invitationId: row.invitation_id,
    email: row.email_normalized,
    role: row.role,
    tokenHash: row.token_hash,
    status: row.invitation_status,
    invitedByAccountId: row.invited_by_account_id,
    acceptedByAccountId: row.accepted_by_account_id,
    expiresAt: timestamp(row.expires_at),
    acceptedAt: nullableTimestamp(row.accepted_at),
    revokedAt: nullableTimestamp(row.revoked_at),
    createdAt: timestamp(row.created_at)
  };
}

function enrollmentFromRow(row: StaffEnrollmentFlowRow): StaffEnrollmentFlow {
  return {
    flowId: row.flow_id,
    invitationId: row.invitation_id,
    tokenHash: row.token_hash,
    accountId: row.account_id,
    factorId: row.factor_id,
    currentStep: row.current_step,
    expiresAt: timestamp(row.expires_at),
    completedAt: nullableTimestamp(row.completed_at),
    cancelledAt: nullableTimestamp(row.cancelled_at),
    createdAt: timestamp(row.created_at),
    updatedAt: timestamp(row.updated_at)
  };
}

function mfaFromRow(row: MfaFactorRow): MfaFactor {
  const parsedCounter =
    row.last_accepted_counter === null
      ? null
      : Number(row.last_accepted_counter);
  if (parsedCounter !== null && !Number.isSafeInteger(parsedCounter)) {
    throw new Error("MFA counter is outside the supported integer range.");
  }
  return {
    factorId: row.factor_id,
    accountId: row.account_id,
    factorType: row.factor_type,
    encryptedSecret: row.encrypted_secret,
    status: row.factor_status,
    lastAcceptedCounter: parsedCounter,
    createdAt: timestamp(row.created_at),
    activatedAt: nullableTimestamp(row.activated_at),
    revokedAt: nullableTimestamp(row.revoked_at)
  };
}

export class AuthAccessRepository {
  readonly authentication: AuthenticationRepository;

  constructor(private readonly database: DatabaseClient) {
    this.authentication = new AuthenticationRepository(database);
  }

  async transaction<T>(
    operation: (repository: AuthAccessRepository) => Promise<T>
  ): Promise<T> {
    return this.database.transaction((client) =>
      operation(new AuthAccessRepository(client))
    );
  }

  async findAccountByEmailForUpdate(
    email: string
  ): Promise<AuthAccount | null> {
    const result = await this.database.query<{ account_id: string }>(
      `SELECT account_id
       FROM auth_accounts
       WHERE email_normalized = $1
       FOR UPDATE`,
      [email]
    );
    const accountId = result.rows[0]?.account_id;
    return accountId
      ? this.authentication.findAccountById(accountId)
      : null;
  }

  async hasRole(accountId: string, role: AuthRole): Promise<boolean> {
    const result = await this.database.query(
      `SELECT 1
       FROM auth_account_roles
       WHERE account_id = $1 AND role = $2`,
      [accountId, role]
    );
    return result.rows.length === 1;
  }

  async countRoleAssignments(role: AuthRole): Promise<number> {
    const result = await this.database.query<{ count: bigint | number | string }>(
      `SELECT COUNT(*) AS count
       FROM auth_account_roles
       WHERE role = $1`,
      [role]
    );
    const count = Number(result.rows[0]?.count ?? 0);
    if (!Number.isSafeInteger(count)) {
      throw new Error("Role assignment count is outside the supported range.");
    }
    return count;
  }

  async consumeAccessRateLimit(input: {
    action: AccessRateLimitAction;
    bucketKey: string;
    now: string;
    resetBefore: string;
  }): Promise<number> {
    const result = await this.database.query<{ attempt_count: number }>(
      `INSERT INTO auth_access_rate_limits (
         action,
         bucket_key,
         window_started_at,
         attempt_count,
         updated_at
       ) VALUES ($1, $2, $3, 1, $3)
       ON CONFLICT (action, bucket_key) DO UPDATE
       SET window_started_at = CASE
             WHEN auth_access_rate_limits.window_started_at <= $4 THEN $3
             ELSE auth_access_rate_limits.window_started_at
           END,
           attempt_count = CASE
             WHEN auth_access_rate_limits.window_started_at <= $4 THEN 1
             ELSE auth_access_rate_limits.attempt_count + 1
           END,
           updated_at = $3
       RETURNING attempt_count`,
      [input.action, input.bucketKey, input.now, input.resetBefore]
    );
    const count = result.rows[0]?.attempt_count;
    if (!Number.isSafeInteger(count)) {
      throw new Error("Access rate-limit update returned no count.");
    }
    return count;
  }

  async invalidateRecoveryFlows(input: {
    accountId: string;
    invalidatedAt: string;
  }): Promise<void> {
    await this.database.query(
      `UPDATE auth_recovery_flows
       SET consumed_at = $2,
           updated_at = $2
       WHERE account_id = $1
         AND consumed_at IS NULL`,
      [input.accountId, input.invalidatedAt]
    );
  }

  async insertRecoveryFlow(input: {
    flowId: string;
    accountId: string;
    activeRole: AuthRole;
    tokenHash: string;
    challengeId: string;
    expiresAt: string;
    createdAt: string;
  }): Promise<RecoveryFlow> {
    const result = await this.database.query<RecoveryFlowRow>(
      `INSERT INTO auth_recovery_flows (
         flow_id,
         account_id,
         active_role,
         token_hash,
         challenge_id,
         expires_at,
         created_at,
         updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
       RETURNING ${RECOVERY_COLUMNS}`,
      [
        input.flowId,
        input.accountId,
        input.activeRole,
        input.tokenHash,
        input.challengeId,
        input.expiresAt,
        input.createdAt
      ]
    );
    const row = result.rows[0];
    if (!row) throw new Error("Recovery flow insert returned no row.");
    return recoveryFromRow(row);
  }

  async findRecoveryFlowForUpdate(
    tokenHash: string
  ): Promise<RecoveryFlow | null> {
    const result = await this.database.query<RecoveryFlowRow>(
      `SELECT ${RECOVERY_COLUMNS}
       FROM auth_recovery_flows
       WHERE token_hash = $1
       FOR UPDATE`,
      [tokenHash]
    );
    return result.rows[0] ? recoveryFromRow(result.rows[0]) : null;
  }

  async updateRecoveryChallenge(input: {
    flowId: string;
    challengeId: string;
    updatedAt: string;
  }): Promise<boolean> {
    const result = await this.database.query(
      `UPDATE auth_recovery_flows
       SET challenge_id = $2,
           updated_at = $3
       WHERE flow_id = $1
         AND consumed_at IS NULL`,
      [input.flowId, input.challengeId, input.updatedAt]
    );
    return result.affectedRows === 1;
  }

  async consumeRecoveryFlow(input: {
    flowId: string;
    consumedAt: string;
  }): Promise<boolean> {
    const result = await this.database.query(
      `UPDATE auth_recovery_flows
       SET consumed_at = $2,
           updated_at = $2
       WHERE flow_id = $1
         AND consumed_at IS NULL
         AND expires_at > $2`,
      [input.flowId, input.consumedAt]
    );
    return result.affectedRows === 1;
  }

  async insertSandboxDelivery(input: {
    deliveryId: string;
    challengeId: string;
    channel: OtpChannel;
    destinationHash: string;
    deliveryHint: string;
    encryptedCode: string;
    createdAt: string;
  }): Promise<void> {
    await this.database.query(
      `INSERT INTO auth_sandbox_deliveries (
         delivery_id,
         challenge_id,
         channel,
         destination_hash,
         delivery_hint,
         encrypted_code,
         created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        input.deliveryId,
        input.challengeId,
        input.channel,
        input.destinationHash,
        input.deliveryHint,
        input.encryptedCode,
        input.createdAt
      ]
    );
  }

  async insertStaffInvitation(input: {
    invitationId: string;
    email: string;
    role: Exclude<AuthRole, "worker">;
    tokenHash: string;
    invitedByAccountId: string | null;
    expiresAt: string;
    createdAt: string;
  }): Promise<StaffInvitation> {
    const result = await this.database.query<StaffInvitationRow>(
      `INSERT INTO auth_staff_invitations (
         invitation_id,
         email_normalized,
         role,
         token_hash,
         invitation_status,
         invited_by_account_id,
         expires_at,
         created_at
       ) VALUES ($1, $2, $3, $4, 'pending', $5, $6, $7)
       RETURNING ${INVITATION_COLUMNS}`,
      [
        input.invitationId,
        input.email,
        input.role,
        input.tokenHash,
        input.invitedByAccountId,
        input.expiresAt,
        input.createdAt
      ]
    );
    const row = result.rows[0];
    if (!row) throw new Error("Staff invitation insert returned no row.");
    return invitationFromRow(row);
  }

  async findStaffInvitationByTokenHashForUpdate(
    tokenHash: string
  ): Promise<StaffInvitation | null> {
    const result = await this.database.query<StaffInvitationRow>(
      `SELECT ${INVITATION_COLUMNS}
       FROM auth_staff_invitations
       WHERE token_hash = $1
       FOR UPDATE`,
      [tokenHash]
    );
    return result.rows[0] ? invitationFromRow(result.rows[0]) : null;
  }

  async listStaffInvitations(
    invitedByAccountId: string,
    limit = 25
  ): Promise<StaffInvitation[]> {
    const result = await this.database.query<StaffInvitationRow>(
      `SELECT ${INVITATION_COLUMNS}
       FROM auth_staff_invitations
       WHERE invited_by_account_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [invitedByAccountId, limit]
    );
    return result.rows.map(invitationFromRow);
  }

  async createOrRotateStaffEnrollmentFlow(input: {
    flowId: string;
    invitationId: string;
    tokenHash: string;
    expiresAt: string;
    now: string;
  }): Promise<StaffEnrollmentFlow> {
    const updated = await this.database.query<StaffEnrollmentFlowRow>(
      `UPDATE auth_staff_enrollment_flows
       SET flow_id = $2,
           token_hash = $3,
           expires_at = $4,
           updated_at = $5
       WHERE invitation_id = $1
         AND current_step IN ('profile', 'totp')
       RETURNING ${ENROLLMENT_COLUMNS}`,
      [
        input.invitationId,
        input.flowId,
        input.tokenHash,
        input.expiresAt,
        input.now
      ]
    );
    if (updated.rows[0]) return enrollmentFromRow(updated.rows[0]);

    const inserted = await this.database.query<StaffEnrollmentFlowRow>(
      `INSERT INTO auth_staff_enrollment_flows (
         flow_id,
         invitation_id,
         token_hash,
         current_step,
         expires_at,
         created_at,
         updated_at
       ) VALUES ($1, $2, $3, 'profile', $4, $5, $5)
       RETURNING ${ENROLLMENT_COLUMNS}`,
      [
        input.flowId,
        input.invitationId,
        input.tokenHash,
        input.expiresAt,
        input.now
      ]
    );
    const row = inserted.rows[0];
    if (!row) throw new Error("Staff enrollment flow insert returned no row.");
    return enrollmentFromRow(row);
  }

  async findStaffEnrollmentFlowByTokenHash(
    tokenHash: string,
    now: string
  ): Promise<StaffEnrollmentFlow | null> {
    const result = await this.database.query<StaffEnrollmentFlowRow>(
      `SELECT ${ENROLLMENT_COLUMNS}
       FROM auth_staff_enrollment_flows
       WHERE token_hash = $1
         AND expires_at > $2
         AND current_step IN ('profile', 'totp', 'complete')`,
      [tokenHash, now]
    );
    return result.rows[0] ? enrollmentFromRow(result.rows[0]) : null;
  }

  async findStaffEnrollmentFlowForUpdate(
    tokenHash: string
  ): Promise<StaffEnrollmentFlow | null> {
    const result = await this.database.query<StaffEnrollmentFlowRow>(
      `SELECT ${ENROLLMENT_COLUMNS}
       FROM auth_staff_enrollment_flows
       WHERE token_hash = $1
       FOR UPDATE`,
      [tokenHash]
    );
    return result.rows[0] ? enrollmentFromRow(result.rows[0]) : null;
  }

  async advanceStaffEnrollmentToTotp(input: {
    flowId: string;
    accountId: string;
    factorId: string;
    updatedAt: string;
  }): Promise<boolean> {
    const result = await this.database.query(
      `UPDATE auth_staff_enrollment_flows
       SET account_id = $2,
           factor_id = $3,
           current_step = 'totp',
           updated_at = $4
       WHERE flow_id = $1
         AND current_step = 'profile'`,
      [input.flowId, input.accountId, input.factorId, input.updatedAt]
    );
    return result.affectedRows === 1;
  }

  async completeStaffEnrollment(input: {
    flowId: string;
    completedAt: string;
  }): Promise<boolean> {
    const result = await this.database.query(
      `UPDATE auth_staff_enrollment_flows
       SET current_step = 'complete',
           completed_at = $2,
           updated_at = $2
       WHERE flow_id = $1
         AND current_step = 'totp'`,
      [input.flowId, input.completedAt]
    );
    return result.affectedRows === 1;
  }

  async cancelStaffEnrollment(input: {
    flowId: string;
    cancelledAt: string;
  }): Promise<boolean> {
    const result = await this.database.query(
      `UPDATE auth_staff_enrollment_flows
       SET current_step = 'cancelled',
           cancelled_at = $2,
           updated_at = $2
       WHERE flow_id = $1
         AND current_step IN ('profile', 'totp')`,
      [input.flowId, input.cancelledAt]
    );
    return result.affectedRows === 1;
  }

  async insertMfaFactor(input: {
    factorId: string;
    accountId: string;
    encryptedSecret: string;
    createdAt: string;
  }): Promise<MfaFactor> {
    const result = await this.database.query<MfaFactorRow>(
      `INSERT INTO auth_mfa_factors (
         factor_id,
         account_id,
         factor_type,
         encrypted_secret,
         factor_status,
         created_at
       ) VALUES ($1, $2, 'totp', $3, 'pending', $4)
       RETURNING ${MFA_COLUMNS}`,
      [input.factorId, input.accountId, input.encryptedSecret, input.createdAt]
    );
    const row = result.rows[0];
    if (!row) throw new Error("MFA factor insert returned no row.");
    return mfaFromRow(row);
  }

  async findMfaFactorForUpdate(
    factorId: string
  ): Promise<MfaFactor | null> {
    const result = await this.database.query<MfaFactorRow>(
      `SELECT ${MFA_COLUMNS}
       FROM auth_mfa_factors
       WHERE factor_id = $1
       FOR UPDATE`,
      [factorId]
    );
    return result.rows[0] ? mfaFromRow(result.rows[0]) : null;
  }

  async findActiveMfaFactorForUpdate(
    accountId: string
  ): Promise<MfaFactor | null> {
    const result = await this.database.query<MfaFactorRow>(
      `SELECT ${MFA_COLUMNS}
       FROM auth_mfa_factors
       WHERE account_id = $1
         AND factor_type = 'totp'
         AND factor_status = 'active'
       FOR UPDATE`,
      [accountId]
    );
    return result.rows[0] ? mfaFromRow(result.rows[0]) : null;
  }

  async activateMfaFactor(input: {
    factorId: string;
    acceptedCounter: number;
    activatedAt: string;
  }): Promise<boolean> {
    const result = await this.database.query(
      `UPDATE auth_mfa_factors
       SET factor_status = 'active',
           last_accepted_counter = $2,
           activated_at = $3
       WHERE factor_id = $1
         AND factor_status = 'pending'
         AND (
           last_accepted_counter IS NULL OR
           last_accepted_counter < $2
         )`,
      [input.factorId, input.acceptedCounter, input.activatedAt]
    );
    return result.affectedRows === 1;
  }

  async acceptMfaCounter(input: {
    factorId: string;
    acceptedCounter: number;
  }): Promise<boolean> {
    const result = await this.database.query(
      `UPDATE auth_mfa_factors
       SET last_accepted_counter = $2
       WHERE factor_id = $1
         AND factor_status = 'active'
         AND (
           last_accepted_counter IS NULL OR
           last_accepted_counter < $2
         )`,
      [input.factorId, input.acceptedCounter]
    );
    return result.affectedRows === 1;
  }

  async markInvitationAccepted(input: {
    invitationId: string;
    accountId: string;
    acceptedAt: string;
  }): Promise<boolean> {
    const result = await this.database.query(
      `UPDATE auth_staff_invitations
       SET invitation_status = 'accepted',
           accepted_by_account_id = $2,
           accepted_at = $3
       WHERE invitation_id = $1
         AND invitation_status = 'pending'
         AND expires_at > $3`,
      [input.invitationId, input.accountId, input.acceptedAt]
    );
    return result.affectedRows === 1;
  }

  async deleteUnfinishedStaffAccount(accountId: string): Promise<boolean> {
    const result = await this.database.query(
      `DELETE FROM auth_accounts AS accounts
       WHERE accounts.account_id = $1
         AND NOT EXISTS (
           SELECT 1
           FROM auth_sessions AS sessions
           WHERE sessions.account_id = accounts.account_id
         )
         AND EXISTS (
           SELECT 1
           FROM auth_mfa_factors AS factors
           WHERE factors.account_id = accounts.account_id
             AND factors.factor_status = 'pending'
         )`,
      [accountId]
    );
    return result.affectedRows === 1;
  }

  async listActiveSessions(
    accountId: string,
    now: string
  ): Promise<ActiveSessionSummary[]> {
    const result = await this.database.query<SessionSummaryRow>(
      `SELECT session_id, active_role, created_at, last_seen_at, expires_at
       FROM auth_sessions
       WHERE account_id = $1
         AND revoked_at IS NULL
         AND expires_at > $2
       ORDER BY last_seen_at DESC`,
      [accountId, now]
    );
    return result.rows.map((row) => ({
      sessionId: row.session_id,
      activeRole: row.active_role,
      createdAt: timestamp(row.created_at),
      lastSeenAt: timestamp(row.last_seen_at),
      expiresAt: timestamp(row.expires_at)
    }));
  }

  async revokeOwnedSession(input: {
    accountId: string;
    sessionId: string;
    revokedAt: string;
    reason: string;
  }): Promise<boolean> {
    const result = await this.database.query(
      `UPDATE auth_sessions
       SET revoked_at = $3,
           revocation_reason = $4
       WHERE account_id = $1
         AND session_id = $2
         AND revoked_at IS NULL`,
      [input.accountId, input.sessionId, input.revokedAt, input.reason]
    );
    return result.affectedRows === 1;
  }
}

export async function getAuthAccessRepository(): Promise<AuthAccessRepository> {
  return new AuthAccessRepository(await getDatabaseClient());
}
