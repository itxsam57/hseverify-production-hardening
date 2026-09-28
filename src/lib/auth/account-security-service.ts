import "server-only";

import { randomBytes } from "node:crypto";

import {
  createIdentifier,
  createTotpSecret,
  decryptSecret,
  encryptSecret,
  hashOpaqueValue,
  hashPassword,
  roleRequiresMfa,
  verifyPassword,
  verifyTotp
} from "@/lib/auth/auth-domain";
import type { AuthenticatedSession } from "@/lib/auth/auth-session-service";
import { getServerEnvironment } from "@/lib/config/server-environment";
import { getDatabaseClient, type DatabaseClient } from "@/lib/database/database";

export type SecurityEventView = Readonly<{
  eventId: string;
  eventType: string;
  role: string | null;
  occurredAt: string;
}>;

export type AccountSecurityOverview = Readonly<{
  mfaRequired: boolean;
  mfaActive: boolean;
  unusedRecoveryCodes: number;
  securityEvents: readonly SecurityEventView[];
}>;

export class AccountSecurityInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AccountSecurityInputError";
  }
}

function formatRecoveryCode(): string {
  const raw = randomBytes(9).toString("base64url").replace(/[-_]/g, "A").toUpperCase().slice(0, 12);
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
}

async function verifyCurrentPassword(
  database: DatabaseClient,
  accountId: string,
  currentPassword: string
): Promise<void> {
  const environment = getServerEnvironment();
  const result = await database.query<{ password_hash: string | null }>(
    "SELECT password_hash FROM auth_accounts WHERE account_id=$1 AND account_status='active'",
    [accountId]
  );
  const stored = result.rows[0]?.password_hash;
  if (!stored || !(await verifyPassword(currentPassword, stored, environment.authPepper))) {
    throw new AccountSecurityInputError("Current password is incorrect.");
  }
}

async function verifyCurrentMfa(
  database: DatabaseClient,
  session: AuthenticatedSession,
  code: string
): Promise<void> {
  if (!roleRequiresMfa(session.role)) return;
  const environment = getServerEnvironment();
  const result = await database.query<{
    factor_id: string;
    encrypted_secret: string;
    last_accepted_counter: number | string | null;
  }>(
    `SELECT factor_id,encrypted_secret,last_accepted_counter
       FROM auth_mfa_factors
      WHERE account_id=$1 AND factor_type='totp' AND factor_status='active'
      FOR UPDATE`,
    [session.accountId]
  );
  const factor = result.rows[0];
  if (!factor) throw new AccountSecurityInputError("Active authenticator is required.");
  const secret = decryptSecret(factor.encrypted_secret, environment.authPepper);
  const verified = verifyTotp({
    secret,
    code: code.trim(),
    lastAcceptedCounter: factor.last_accepted_counter === null ? null : Number(factor.last_accepted_counter)
  });
  if (!verified.valid || verified.counter === null) {
    throw new AccountSecurityInputError("Authenticator code is invalid or already used.");
  }
  const accepted = await database.query(
    `UPDATE auth_mfa_factors
        SET last_accepted_counter=$2
      WHERE factor_id=$1
        AND factor_status='active'
        AND (last_accepted_counter IS NULL OR last_accepted_counter < $2)`,
    [factor.factor_id, verified.counter]
  );
  if (accepted.affectedRows !== 1) {
    throw new AccountSecurityInputError("Authenticator code is invalid or already used.");
  }
}

async function securityEvent(
  database: DatabaseClient,
  session: AuthenticatedSession,
  eventType: string,
  metadata: Record<string, unknown> = {}
): Promise<void> {
  await database.query(
    `INSERT INTO auth_security_events(
       event_id,account_id,event_type,active_role,metadata,occurred_at
     ) VALUES($1,$2,$3,$4,$5::jsonb,$6)`,
    [
      createIdentifier("event"),
      session.accountId,
      eventType,
      session.role,
      JSON.stringify(metadata),
      new Date().toISOString()
    ]
  );
}

export class AccountSecurityService {
  constructor(private readonly databasePromise: Promise<DatabaseClient> = getDatabaseClient()) {}

  async overview(session: AuthenticatedSession): Promise<AccountSecurityOverview> {
    const database = await this.databasePromise;
    const [factor, recovery, events] = await Promise.all([
      database.query<{ active: boolean }>(
        `SELECT EXISTS(
           SELECT 1 FROM auth_mfa_factors
            WHERE account_id=$1 AND factor_type='totp' AND factor_status='active'
         ) AS active`,
        [session.accountId]
      ),
      database.query<{ count: number | string }>(
        "SELECT count(*) AS count FROM auth_mfa_recovery_codes WHERE account_id=$1 AND used_at IS NULL",
        [session.accountId]
      ),
      database.query<{ event_id: string; event_type: string; active_role: string | null; occurred_at: string | Date }>(
        `SELECT event_id,event_type,active_role,occurred_at
           FROM auth_security_events
          WHERE account_id=$1
          ORDER BY occurred_at DESC,event_id DESC
          LIMIT 25`,
        [session.accountId]
      )
    ]);
    return Object.freeze({
      mfaRequired: roleRequiresMfa(session.role),
      mfaActive: Boolean(factor.rows[0]?.active),
      unusedRecoveryCodes: Number(recovery.rows[0]?.count ?? 0),
      securityEvents: Object.freeze(events.rows.map((row) => Object.freeze({
        eventId: row.event_id,
        eventType: row.event_type,
        role: row.active_role,
        occurredAt: row.occurred_at instanceof Date ? row.occurred_at.toISOString() : new Date(row.occurred_at).toISOString()
      })))
    });
  }

  async changePassword(input: {
    session: AuthenticatedSession;
    currentPassword: string;
    newPassword: string;
    mfaCode?: string;
  }): Promise<void> {
    const database = await this.databasePromise;
    const environment = getServerEnvironment();
    await database.transaction(async (tx) => {
      await verifyCurrentPassword(tx, input.session.accountId, input.currentPassword);
      await verifyCurrentMfa(tx, input.session, input.mfaCode ?? "");
      const passwordHash = await hashPassword(input.newPassword, environment.authPepper);
      const now = new Date().toISOString();
      const updated = await tx.query(
        `UPDATE auth_accounts SET password_hash=$2,password_set_at=$3,updated_at=$3
          WHERE account_id=$1 AND account_status='active'`,
        [input.session.accountId, passwordHash, now]
      );
      if (updated.affectedRows !== 1) throw new AccountSecurityInputError("Password could not be changed.");
      await tx.query(
        `UPDATE auth_sessions
            SET revoked_at=$2,revocation_reason='password_changed'
          WHERE account_id=$1 AND session_id<>$3 AND revoked_at IS NULL`,
        [input.session.accountId, now, input.session.sessionId]
      );
      await securityEvent(tx, input.session, "password_changed", { otherSessionsRevoked: true });
    });
  }

  async rotateRecoveryCodes(input: {
    session: AuthenticatedSession;
    currentPassword: string;
    mfaCode?: string;
  }): Promise<readonly string[]> {
    const database = await this.databasePromise;
    const environment = getServerEnvironment();
    const codes = Array.from({ length: 10 }, () => formatRecoveryCode());
    await database.transaction(async (tx) => {
      await verifyCurrentPassword(tx, input.session.accountId, input.currentPassword);
      await verifyCurrentMfa(tx, input.session, input.mfaCode ?? "");
      await tx.query("DELETE FROM auth_mfa_recovery_codes WHERE account_id=$1", [input.session.accountId]);
      const now = new Date().toISOString();
      for (const code of codes) {
        await tx.query(
          `INSERT INTO auth_mfa_recovery_codes(recovery_code_id,account_id,code_hash,created_at)
           VALUES($1,$2,$3,$4)`,
          [
            createIdentifier("mfa_recovery"),
            input.session.accountId,
            hashOpaqueValue(code, environment.authPepper, "mfa-recovery"),
            now
          ]
        );
      }
      await securityEvent(tx, input.session, "mfa_recovery_codes_rotated", { count: codes.length });
    });
    return Object.freeze(codes);
  }

  async startMfaReplacement(input: {
    session: AuthenticatedSession;
    currentPassword: string;
    mfaCode: string;
  }): Promise<Readonly<{ challengeId: string; secret: string; setupUri: string }>> {
    if (!roleRequiresMfa(input.session.role)) {
      throw new AccountSecurityInputError("Authenticator replacement is only available for MFA-protected staff roles.");
    }
    const database = await this.databasePromise;
    const environment = getServerEnvironment();
    return database.transaction(async (tx) => {
      await verifyCurrentPassword(tx, input.session.accountId, input.currentPassword);
      await verifyCurrentMfa(tx, input.session, input.mfaCode);
      await tx.query(
        "DELETE FROM auth_mfa_rotation_challenges WHERE account_id=$1 AND consumed_at IS NULL",
        [input.session.accountId]
      );
      const secret = createTotpSecret();
      const challengeId = createIdentifier("mfa_rotation");
      const now = new Date();
      const expiresAt = new Date(now.getTime() + 10 * 60 * 1000).toISOString();
      await tx.query(
        `INSERT INTO auth_mfa_rotation_challenges(
           challenge_id,account_id,encrypted_secret,expires_at,created_at
         ) VALUES($1,$2,$3,$4,$5)`,
        [
          challengeId,
          input.session.accountId,
          encryptSecret(secret, environment.authPepper),
          expiresAt,
          now.toISOString()
        ]
      );
      const label = encodeURIComponent(`HSE Verify:${input.session.email}`);
      const issuer = encodeURIComponent("HSE Verify");
      return Object.freeze({
        challengeId,
        secret,
        setupUri: `otpauth://totp/${label}?secret=${secret}&issuer=${issuer}`
      });
    });
  }

  async confirmMfaReplacement(input: {
    session: AuthenticatedSession;
    challengeId: string;
    newCode: string;
  }): Promise<void> {
    const database = await this.databasePromise;
    const environment = getServerEnvironment();
    await database.transaction(async (tx) => {
      const challenge = await tx.query<{ encrypted_secret: string }>(
        `SELECT encrypted_secret
           FROM auth_mfa_rotation_challenges
          WHERE challenge_id=$1 AND account_id=$2 AND consumed_at IS NULL AND expires_at>CURRENT_TIMESTAMP
          FOR UPDATE`,
        [input.challengeId, input.session.accountId]
      );
      const row = challenge.rows[0];
      if (!row) throw new AccountSecurityInputError("Authenticator replacement expired. Start again.");
      const secret = decryptSecret(row.encrypted_secret, environment.authPepper);
      const verified = verifyTotp({ secret, code: input.newCode.trim(), window: 1 });
      if (!verified.valid || verified.counter === null) {
        throw new AccountSecurityInputError("New authenticator code is invalid.");
      }
      const now = new Date().toISOString();
      await tx.query(
        `UPDATE auth_mfa_factors
            SET factor_status='revoked',revoked_at=$2
          WHERE account_id=$1 AND factor_type='totp' AND factor_status='active'`,
        [input.session.accountId, now]
      );
      await tx.query(
        `INSERT INTO auth_mfa_factors(
           factor_id,account_id,factor_type,encrypted_secret,factor_status,last_accepted_counter,
           created_at,activated_at
         ) VALUES($1,$2,'totp',$3,'active',$4,$5,$5)`,
        [
          createIdentifier("mfa"),
          input.session.accountId,
          encryptSecret(secret, environment.authPepper),
          verified.counter,
          now
        ]
      );
      await tx.query(
        "UPDATE auth_mfa_rotation_challenges SET consumed_at=$3 WHERE challenge_id=$1 AND account_id=$2",
        [input.challengeId, input.session.accountId, now]
      );
      await securityEvent(tx, input.session, "mfa_replaced");
    });
  }

  async consumeRecoveryCode(accountId: string, code: string): Promise<boolean> {
    const normalized = code.trim().toUpperCase();
    if (!/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(normalized)) return false;
    const environment = getServerEnvironment();
    const database = await this.databasePromise;
    const hash = hashOpaqueValue(normalized, environment.authPepper, "mfa-recovery");
    const result = await database.query(
      `UPDATE auth_mfa_recovery_codes
          SET used_at=CURRENT_TIMESTAMP
        WHERE account_id=$1 AND code_hash=$2 AND used_at IS NULL`,
      [accountId, hash]
    );
    return result.affectedRows === 1;
  }
}

let service: AccountSecurityService | null = null;
export function getAccountSecurityService(): AccountSecurityService {
  service ??= new AccountSecurityService();
  return service;
}
