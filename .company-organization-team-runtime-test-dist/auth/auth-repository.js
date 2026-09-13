"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthenticationRepository = void 0;
exports.getAuthenticationRepository = getAuthenticationRepository;
const database_1 = require("../database/database");
const ACCOUNT_COLUMNS = `
  account_id,
  email_normalized,
  phone_e164,
  display_name,
  account_status,
  password_hash,
  worker_reference,
  email_verified_at,
  phone_verified_at,
  failed_sign_in_count,
  locked_until,
  created_at,
  updated_at
`;
const OTP_COLUMNS = `
  challenge_id,
  account_id,
  purpose,
  channel,
  destination_hash,
  delivery_hint,
  code_hash,
  attempts_remaining,
  resend_available_at,
  expires_at,
  consumed_at,
  invalidated_at,
  created_at
`;
const SESSION_COLUMNS = `
  sessions.session_id,
  sessions.account_id,
  sessions.active_role,
  sessions.token_hash,
  sessions.csrf_token_hash,
  sessions.user_agent_hash,
  sessions.ip_address_hash,
  sessions.created_at,
  sessions.last_seen_at,
  sessions.expires_at,
  sessions.revoked_at,
  sessions.revocation_reason
`;
function accountFromRow(row) {
    return {
        accountId: row.account_id,
        email: row.email_normalized,
        phone: row.phone_e164,
        displayName: row.display_name,
        status: row.account_status,
        passwordHash: row.password_hash,
        workerReference: row.worker_reference,
        emailVerifiedAt: row.email_verified_at,
        phoneVerifiedAt: row.phone_verified_at,
        failedSignInCount: row.failed_sign_in_count,
        lockedUntil: row.locked_until,
        createdAt: row.created_at,
        updatedAt: row.updated_at
    };
}
function otpFromRow(row) {
    return {
        challengeId: row.challenge_id,
        accountId: row.account_id,
        purpose: row.purpose,
        channel: row.channel,
        destinationHash: row.destination_hash,
        deliveryHint: row.delivery_hint,
        codeHash: row.code_hash,
        attemptsRemaining: row.attempts_remaining,
        resendAvailableAt: row.resend_available_at,
        expiresAt: row.expires_at,
        consumedAt: row.consumed_at,
        invalidatedAt: row.invalidated_at,
        createdAt: row.created_at
    };
}
function sessionFromRow(row) {
    return {
        sessionId: row.session_id,
        accountId: row.account_id,
        activeRole: row.active_role,
        tokenHash: row.token_hash,
        csrfTokenHash: row.csrf_token_hash,
        userAgentHash: row.user_agent_hash,
        ipAddressHash: row.ip_address_hash,
        createdAt: row.created_at,
        lastSeenAt: row.last_seen_at,
        expiresAt: row.expires_at,
        revokedAt: row.revoked_at,
        revocationReason: row.revocation_reason
    };
}
class AuthenticationRepository {
    database;
    constructor(database) {
        this.database = database;
    }
    async transaction(operation) {
        return this.database.transaction((client) => operation(new AuthenticationRepository(client)));
    }
    async findAccountByEmail(email) {
        const result = await this.database.query(`SELECT ${ACCOUNT_COLUMNS}
       FROM auth_accounts
       WHERE email_normalized = $1`, [email]);
        return result.rows[0] ? accountFromRow(result.rows[0]) : null;
    }
    async findAccountById(accountId) {
        const result = await this.database.query(`SELECT ${ACCOUNT_COLUMNS}
       FROM auth_accounts
       WHERE account_id = $1`, [accountId]);
        return result.rows[0] ? accountFromRow(result.rows[0]) : null;
    }
    async listRoles(accountId) {
        const result = await this.database.query(`SELECT role
       FROM auth_account_roles
       WHERE account_id = $1
       ORDER BY role`, [accountId]);
        return result.rows.map((row) => row.role);
    }
    async insertAccount(input) {
        const result = await this.database.query(`INSERT INTO auth_accounts (
         account_id,
         email_normalized,
         phone_e164,
         display_name,
         account_status,
         password_hash,
         worker_reference,
         password_set_at,
         created_at,
         updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
       RETURNING ${ACCOUNT_COLUMNS}`, [
            input.accountId,
            input.email,
            input.phone,
            input.displayName,
            input.status,
            input.passwordHash,
            input.workerReference,
            input.passwordHash ? input.now : null,
            input.now
        ]);
        const row = result.rows[0];
        if (!row) {
            throw new Error("Authentication account insert returned no row.");
        }
        return accountFromRow(row);
    }
    async addRole(accountId, role, now) {
        await this.database.query(`INSERT INTO auth_account_roles (account_id, role, created_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (account_id, role) DO NOTHING`, [accountId, role, now]);
    }
    async updateAccountAfterEmailVerification(accountId, verifiedAt) {
        const result = await this.database.query(`UPDATE auth_accounts
       SET email_verified_at = COALESCE(email_verified_at, $2),
           account_status = CASE
             WHEN phone_e164 IS NULL OR phone_verified_at IS NOT NULL THEN 'active'
             ELSE 'pending_phone'
           END,
           updated_at = $2
       WHERE account_id = $1
         AND account_status IN ('pending_email', 'pending_phone', 'active')
       RETURNING ${ACCOUNT_COLUMNS}`, [accountId, verifiedAt]);
        const row = result.rows[0];
        if (!row) {
            throw new Error("Email verification account transition failed.");
        }
        return accountFromRow(row);
    }
    async updateAccountAfterPhoneVerification(accountId, verifiedAt) {
        const result = await this.database.query(`UPDATE auth_accounts
       SET phone_verified_at = COALESCE(phone_verified_at, $2),
           account_status = CASE
             WHEN email_verified_at IS NOT NULL THEN 'active'
             ELSE 'pending_email'
           END,
           updated_at = $2
       WHERE account_id = $1
         AND account_status IN ('pending_email', 'pending_phone', 'active')
       RETURNING ${ACCOUNT_COLUMNS}`, [accountId, verifiedAt]);
        const row = result.rows[0];
        if (!row) {
            throw new Error("Phone verification account transition failed.");
        }
        return accountFromRow(row);
    }
    async setPassword(accountId, passwordHash, changedAt) {
        const result = await this.database.query(`UPDATE auth_accounts
       SET password_hash = $2,
           password_set_at = $3,
           failed_sign_in_count = 0,
           locked_until = NULL,
           account_status = CASE
             WHEN account_status = 'locked' THEN 'active'
             ELSE account_status
           END,
           updated_at = $3
       WHERE account_id = $1
         AND account_status <> 'disabled'`, [accountId, passwordHash, changedAt]);
        if (result.affectedRows !== 1) {
            throw new Error("Password update failed.");
        }
    }
    async invalidateOtpChallenges(input) {
        await this.database.query(`UPDATE auth_otp_challenges
       SET invalidated_at = $3
       WHERE account_id = $1
         AND purpose = $2
         AND consumed_at IS NULL
         AND invalidated_at IS NULL`, [input.accountId, input.purpose, input.invalidatedAt]);
    }
    async insertOtpChallenge(input) {
        const result = await this.database.query(`INSERT INTO auth_otp_challenges (
         challenge_id,
         account_id,
         purpose,
         channel,
         destination_hash,
         delivery_hint,
         code_hash,
         attempts_remaining,
         resend_available_at,
         expires_at,
         created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING ${OTP_COLUMNS}`, [
            input.challengeId,
            input.accountId,
            input.purpose,
            input.channel,
            input.destinationHash,
            input.deliveryHint,
            input.codeHash,
            input.attemptsRemaining,
            input.resendAvailableAt,
            input.expiresAt,
            input.createdAt
        ]);
        const row = result.rows[0];
        if (!row) {
            throw new Error("OTP challenge insert returned no row.");
        }
        return otpFromRow(row);
    }
    async findOtpChallengeForUpdate(challengeId) {
        const result = await this.database.query(`SELECT ${OTP_COLUMNS}
       FROM auth_otp_challenges
       WHERE challenge_id = $1
       FOR UPDATE`, [challengeId]);
        return result.rows[0] ? otpFromRow(result.rows[0]) : null;
    }
    async recordOtpFailure(challengeId, failedAt) {
        const result = await this.database.query(`UPDATE auth_otp_challenges
       SET attempts_remaining = GREATEST(attempts_remaining - 1, 0),
           invalidated_at = CASE
             WHEN attempts_remaining <= 1 THEN $2::timestamptz
             ELSE invalidated_at
           END
       WHERE challenge_id = $1
         AND consumed_at IS NULL
         AND invalidated_at IS NULL
       RETURNING attempts_remaining`, [challengeId, failedAt]);
        return result.rows[0]?.attempts_remaining ?? 0;
    }
    async consumeOtpChallenge(challengeId, consumedAt) {
        const result = await this.database.query(`UPDATE auth_otp_challenges
       SET consumed_at = $2
       WHERE challenge_id = $1
         AND consumed_at IS NULL
         AND invalidated_at IS NULL
         AND expires_at > $2
         AND attempts_remaining > 0`, [challengeId, consumedAt]);
        return result.affectedRows === 1;
    }
    async insertSession(input) {
        const result = await this.database.query(`INSERT INTO auth_sessions (
         session_id,
         account_id,
         active_role,
         token_hash,
         csrf_token_hash,
         user_agent_hash,
         ip_address_hash,
         created_at,
         last_seen_at,
         expires_at,
         revoked_at,
         revocation_reason
       )
       SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NULL, NULL
       FROM auth_accounts
       WHERE account_id = $2
         AND account_status = 'active'
       RETURNING session_id`, [
            input.sessionId,
            input.accountId,
            input.activeRole,
            input.tokenHash,
            input.csrfTokenHash,
            input.userAgentHash,
            input.ipAddressHash,
            input.createdAt,
            input.lastSeenAt,
            input.expiresAt
        ]);
        if (result.rows.length !== 1) {
            throw new Error("A session can only be created for an active account.");
        }
    }
    async findActiveSessionByTokenHash(tokenHash, now) {
        const result = await this.database.query(`SELECT ${SESSION_COLUMNS}
       FROM auth_sessions AS sessions
       INNER JOIN auth_accounts AS accounts
         ON accounts.account_id = sessions.account_id
       WHERE sessions.token_hash = $1
         AND sessions.revoked_at IS NULL
         AND sessions.expires_at > $2
         AND accounts.account_status = 'active'`, [tokenHash, now]);
        return result.rows[0] ? sessionFromRow(result.rows[0]) : null;
    }
    async touchSession(sessionId, touchedAt) {
        await this.database.query(`UPDATE auth_sessions
       SET last_seen_at = $2
       WHERE session_id = $1
         AND revoked_at IS NULL
         AND expires_at > $2
         AND last_seen_at < $2`, [sessionId, touchedAt]);
    }
    async revokeSession(input) {
        const result = await this.database.query(`UPDATE auth_sessions
       SET revoked_at = $2,
           revocation_reason = $3
       WHERE session_id = $1
         AND revoked_at IS NULL`, [input.sessionId, input.revokedAt, input.reason]);
        return result.affectedRows === 1;
    }
    async revokeAllSessions(input) {
        const result = await this.database.query(`UPDATE auth_sessions
       SET revoked_at = $2,
           revocation_reason = $3
       WHERE account_id = $1
         AND revoked_at IS NULL
         AND ($4::text IS NULL OR session_id <> $4)`, [
            input.accountId,
            input.revokedAt,
            input.reason,
            input.exceptSessionId ?? null
        ]);
        return result.affectedRows;
    }
    async recordLoginFailure(input) {
        const result = await this.database.query(`UPDATE auth_accounts
       SET failed_sign_in_count = failed_sign_in_count + 1,
           account_status = CASE
             WHEN failed_sign_in_count + 1 >= $3 THEN 'locked'
             ELSE account_status
           END,
           locked_until = CASE
             WHEN failed_sign_in_count + 1 >= $3 THEN $4::timestamptz
             ELSE NULL::timestamptz
           END,
           updated_at = $2::timestamptz
       WHERE account_id = $1
         AND account_status = 'active'
       RETURNING ${ACCOUNT_COLUMNS}`, [input.accountId, input.failedAt, input.lockAtCount, input.lockUntil]);
        const row = result.rows[0];
        if (!row) {
            throw new Error("Only an active account can record a sign-in failure.");
        }
        return accountFromRow(row);
    }
    async clearLoginFailures(accountId, clearedAt) {
        const result = await this.database.query(`UPDATE auth_accounts
       SET failed_sign_in_count = 0,
           locked_until = NULL,
           account_status = 'active',
           updated_at = $2
       WHERE account_id = $1
         AND account_status IN ('active', 'locked')`, [accountId, clearedAt]);
        if (result.affectedRows !== 1) {
            throw new Error("Only an active or locked account can clear sign-in failures.");
        }
    }
    async insertSecurityEvent(input) {
        await this.database.query(`INSERT INTO auth_security_events (
         event_id,
         account_id,
         event_type,
         active_role,
         request_fingerprint_hash,
         metadata,
         occurred_at
       ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`, [
            input.eventId,
            input.accountId,
            input.eventType,
            input.activeRole ?? null,
            input.requestFingerprintHash ?? null,
            JSON.stringify(input.metadata ?? {}),
            input.occurredAt
        ]);
    }
}
exports.AuthenticationRepository = AuthenticationRepository;
async function getAuthenticationRepository() {
    return new AuthenticationRepository(await (0, database_1.getDatabaseClient)());
}
