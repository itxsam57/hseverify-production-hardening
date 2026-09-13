"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthAccessRepository = void 0;
exports.getAuthAccessRepository = getAuthAccessRepository;
const auth_repository_1 = require("./auth-repository");
const database_1 = require("../database/database");
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
function timestamp(value) {
    return value instanceof Date ? value.toISOString() : value;
}
function nullableTimestamp(value) {
    return value === null ? null : timestamp(value);
}
function recoveryFromRow(row) {
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
function invitationFromRow(row) {
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
function enrollmentFromRow(row) {
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
function mfaFromRow(row) {
    const parsedCounter = row.last_accepted_counter === null
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
class AuthAccessRepository {
    database;
    authentication;
    constructor(database) {
        this.database = database;
        this.authentication = new auth_repository_1.AuthenticationRepository(database);
    }
    async transaction(operation) {
        return this.database.transaction((client) => operation(new AuthAccessRepository(client)));
    }
    async findAccountByEmailForUpdate(email) {
        const result = await this.database.query(`SELECT account_id
       FROM auth_accounts
       WHERE email_normalized = $1
       FOR UPDATE`, [email]);
        const accountId = result.rows[0]?.account_id;
        return accountId
            ? this.authentication.findAccountById(accountId)
            : null;
    }
    async hasRole(accountId, role) {
        const result = await this.database.query(`SELECT 1
       FROM auth_account_roles
       WHERE account_id = $1 AND role = $2`, [accountId, role]);
        return result.rows.length === 1;
    }
    async countRoleAssignments(role) {
        const result = await this.database.query(`SELECT COUNT(*) AS count
       FROM auth_account_roles
       WHERE role = $1`, [role]);
        const count = Number(result.rows[0]?.count ?? 0);
        if (!Number.isSafeInteger(count)) {
            throw new Error("Role assignment count is outside the supported range.");
        }
        return count;
    }
    async consumeAccessRateLimit(input) {
        const result = await this.database.query(`INSERT INTO auth_access_rate_limits (
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
       RETURNING attempt_count`, [input.action, input.bucketKey, input.now, input.resetBefore]);
        const count = result.rows[0]?.attempt_count;
        if (!Number.isSafeInteger(count)) {
            throw new Error("Access rate-limit update returned no count.");
        }
        return count;
    }
    async invalidateRecoveryFlows(input) {
        await this.database.query(`UPDATE auth_recovery_flows
       SET consumed_at = $2,
           updated_at = $2
       WHERE account_id = $1
         AND consumed_at IS NULL`, [input.accountId, input.invalidatedAt]);
    }
    async insertRecoveryFlow(input) {
        const result = await this.database.query(`INSERT INTO auth_recovery_flows (
         flow_id,
         account_id,
         active_role,
         token_hash,
         challenge_id,
         expires_at,
         created_at,
         updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
       RETURNING ${RECOVERY_COLUMNS}`, [
            input.flowId,
            input.accountId,
            input.activeRole,
            input.tokenHash,
            input.challengeId,
            input.expiresAt,
            input.createdAt
        ]);
        const row = result.rows[0];
        if (!row)
            throw new Error("Recovery flow insert returned no row.");
        return recoveryFromRow(row);
    }
    async findRecoveryFlowForUpdate(tokenHash) {
        const result = await this.database.query(`SELECT ${RECOVERY_COLUMNS}
       FROM auth_recovery_flows
       WHERE token_hash = $1
       FOR UPDATE`, [tokenHash]);
        return result.rows[0] ? recoveryFromRow(result.rows[0]) : null;
    }
    async updateRecoveryChallenge(input) {
        const result = await this.database.query(`UPDATE auth_recovery_flows
       SET challenge_id = $2,
           updated_at = $3
       WHERE flow_id = $1
         AND consumed_at IS NULL`, [input.flowId, input.challengeId, input.updatedAt]);
        return result.affectedRows === 1;
    }
    async consumeRecoveryFlow(input) {
        const result = await this.database.query(`UPDATE auth_recovery_flows
       SET consumed_at = $2,
           updated_at = $2
       WHERE flow_id = $1
         AND consumed_at IS NULL
         AND expires_at > $2`, [input.flowId, input.consumedAt]);
        return result.affectedRows === 1;
    }
    async insertSandboxDelivery(input) {
        await this.database.query(`INSERT INTO auth_sandbox_deliveries (
         delivery_id,
         challenge_id,
         channel,
         destination_hash,
         delivery_hint,
         encrypted_code,
         created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7)`, [
            input.deliveryId,
            input.challengeId,
            input.channel,
            input.destinationHash,
            input.deliveryHint,
            input.encryptedCode,
            input.createdAt
        ]);
    }
    async insertStaffInvitation(input) {
        const result = await this.database.query(`INSERT INTO auth_staff_invitations (
         invitation_id,
         email_normalized,
         role,
         token_hash,
         invitation_status,
         invited_by_account_id,
         expires_at,
         created_at
       ) VALUES ($1, $2, $3, $4, 'pending', $5, $6, $7)
       RETURNING ${INVITATION_COLUMNS}`, [
            input.invitationId,
            input.email,
            input.role,
            input.tokenHash,
            input.invitedByAccountId,
            input.expiresAt,
            input.createdAt
        ]);
        const row = result.rows[0];
        if (!row)
            throw new Error("Staff invitation insert returned no row.");
        return invitationFromRow(row);
    }
    async findStaffInvitationByTokenHashForUpdate(tokenHash) {
        const result = await this.database.query(`SELECT ${INVITATION_COLUMNS}
       FROM auth_staff_invitations
       WHERE token_hash = $1
       FOR UPDATE`, [tokenHash]);
        return result.rows[0] ? invitationFromRow(result.rows[0]) : null;
    }
    async listStaffInvitations(invitedByAccountId, limit = 25) {
        const result = await this.database.query(`SELECT ${INVITATION_COLUMNS}
       FROM auth_staff_invitations
       WHERE invited_by_account_id = $1
       ORDER BY created_at DESC
       LIMIT $2`, [invitedByAccountId, limit]);
        return result.rows.map(invitationFromRow);
    }
    async createOrRotateStaffEnrollmentFlow(input) {
        const updated = await this.database.query(`UPDATE auth_staff_enrollment_flows
       SET flow_id = $2,
           token_hash = $3,
           expires_at = $4,
           updated_at = $5
       WHERE invitation_id = $1
         AND current_step IN ('profile', 'totp')
       RETURNING ${ENROLLMENT_COLUMNS}`, [
            input.invitationId,
            input.flowId,
            input.tokenHash,
            input.expiresAt,
            input.now
        ]);
        if (updated.rows[0])
            return enrollmentFromRow(updated.rows[0]);
        const inserted = await this.database.query(`INSERT INTO auth_staff_enrollment_flows (
         flow_id,
         invitation_id,
         token_hash,
         current_step,
         expires_at,
         created_at,
         updated_at
       ) VALUES ($1, $2, $3, 'profile', $4, $5, $5)
       RETURNING ${ENROLLMENT_COLUMNS}`, [
            input.flowId,
            input.invitationId,
            input.tokenHash,
            input.expiresAt,
            input.now
        ]);
        const row = inserted.rows[0];
        if (!row)
            throw new Error("Staff enrollment flow insert returned no row.");
        return enrollmentFromRow(row);
    }
    async findStaffEnrollmentFlowByTokenHash(tokenHash, now) {
        const result = await this.database.query(`SELECT ${ENROLLMENT_COLUMNS}
       FROM auth_staff_enrollment_flows
       WHERE token_hash = $1
         AND expires_at > $2
         AND current_step IN ('profile', 'totp', 'complete')`, [tokenHash, now]);
        return result.rows[0] ? enrollmentFromRow(result.rows[0]) : null;
    }
    async findStaffEnrollmentFlowForUpdate(tokenHash) {
        const result = await this.database.query(`SELECT ${ENROLLMENT_COLUMNS}
       FROM auth_staff_enrollment_flows
       WHERE token_hash = $1
       FOR UPDATE`, [tokenHash]);
        return result.rows[0] ? enrollmentFromRow(result.rows[0]) : null;
    }
    async advanceStaffEnrollmentToTotp(input) {
        const result = await this.database.query(`UPDATE auth_staff_enrollment_flows
       SET account_id = $2,
           factor_id = $3,
           current_step = 'totp',
           updated_at = $4
       WHERE flow_id = $1
         AND current_step = 'profile'`, [input.flowId, input.accountId, input.factorId, input.updatedAt]);
        return result.affectedRows === 1;
    }
    async completeStaffEnrollment(input) {
        const result = await this.database.query(`UPDATE auth_staff_enrollment_flows
       SET current_step = 'complete',
           completed_at = $2,
           updated_at = $2
       WHERE flow_id = $1
         AND current_step = 'totp'`, [input.flowId, input.completedAt]);
        return result.affectedRows === 1;
    }
    async cancelStaffEnrollment(input) {
        const result = await this.database.query(`UPDATE auth_staff_enrollment_flows
       SET current_step = 'cancelled',
           cancelled_at = $2,
           updated_at = $2
       WHERE flow_id = $1
         AND current_step IN ('profile', 'totp')`, [input.flowId, input.cancelledAt]);
        return result.affectedRows === 1;
    }
    async insertMfaFactor(input) {
        const result = await this.database.query(`INSERT INTO auth_mfa_factors (
         factor_id,
         account_id,
         factor_type,
         encrypted_secret,
         factor_status,
         created_at
       ) VALUES ($1, $2, 'totp', $3, 'pending', $4)
       RETURNING ${MFA_COLUMNS}`, [input.factorId, input.accountId, input.encryptedSecret, input.createdAt]);
        const row = result.rows[0];
        if (!row)
            throw new Error("MFA factor insert returned no row.");
        return mfaFromRow(row);
    }
    async findMfaFactorForUpdate(factorId) {
        const result = await this.database.query(`SELECT ${MFA_COLUMNS}
       FROM auth_mfa_factors
       WHERE factor_id = $1
       FOR UPDATE`, [factorId]);
        return result.rows[0] ? mfaFromRow(result.rows[0]) : null;
    }
    async findActiveMfaFactorForUpdate(accountId) {
        const result = await this.database.query(`SELECT ${MFA_COLUMNS}
       FROM auth_mfa_factors
       WHERE account_id = $1
         AND factor_type = 'totp'
         AND factor_status = 'active'
       FOR UPDATE`, [accountId]);
        return result.rows[0] ? mfaFromRow(result.rows[0]) : null;
    }
    async activateMfaFactor(input) {
        const result = await this.database.query(`UPDATE auth_mfa_factors
       SET factor_status = 'active',
           last_accepted_counter = $2,
           activated_at = $3
       WHERE factor_id = $1
         AND factor_status = 'pending'
         AND (
           last_accepted_counter IS NULL OR
           last_accepted_counter < $2
         )`, [input.factorId, input.acceptedCounter, input.activatedAt]);
        return result.affectedRows === 1;
    }
    async acceptMfaCounter(input) {
        const result = await this.database.query(`UPDATE auth_mfa_factors
       SET last_accepted_counter = $2
       WHERE factor_id = $1
         AND factor_status = 'active'
         AND (
           last_accepted_counter IS NULL OR
           last_accepted_counter < $2
         )`, [input.factorId, input.acceptedCounter]);
        return result.affectedRows === 1;
    }
    async markInvitationAccepted(input) {
        const result = await this.database.query(`UPDATE auth_staff_invitations
       SET invitation_status = 'accepted',
           accepted_by_account_id = $2,
           accepted_at = $3
       WHERE invitation_id = $1
         AND invitation_status = 'pending'
         AND expires_at > $3`, [input.invitationId, input.accountId, input.acceptedAt]);
        return result.affectedRows === 1;
    }
    async deleteUnfinishedStaffAccount(accountId) {
        const result = await this.database.query(`DELETE FROM auth_accounts AS accounts
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
         )`, [accountId]);
        return result.affectedRows === 1;
    }
    async listActiveSessions(accountId, now) {
        const result = await this.database.query(`SELECT session_id, active_role, created_at, last_seen_at, expires_at
       FROM auth_sessions
       WHERE account_id = $1
         AND revoked_at IS NULL
         AND expires_at > $2
       ORDER BY last_seen_at DESC`, [accountId, now]);
        return result.rows.map((row) => ({
            sessionId: row.session_id,
            activeRole: row.active_role,
            createdAt: timestamp(row.created_at),
            lastSeenAt: timestamp(row.last_seen_at),
            expiresAt: timestamp(row.expires_at)
        }));
    }
    async revokeOwnedSession(input) {
        const result = await this.database.query(`UPDATE auth_sessions
       SET revoked_at = $3,
           revocation_reason = $4
       WHERE account_id = $1
         AND session_id = $2
         AND revoked_at IS NULL`, [input.accountId, input.sessionId, input.revokedAt, input.reason]);
        return result.affectedRows === 1;
    }
}
exports.AuthAccessRepository = AuthAccessRepository;
async function getAuthAccessRepository() {
    return new AuthAccessRepository(await (0, database_1.getDatabaseClient)());
}
