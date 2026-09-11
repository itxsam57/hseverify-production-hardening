import "server-only";

import type { AuthAccount, AuthOtpChallenge } from "@/lib/auth/auth-repository";
import { AuthenticationRepository } from "@/lib/auth/auth-repository";
import type { OtpChannel, OtpPurpose } from "@/lib/auth/auth-domain";
import {
  getDatabaseClient,
  type DatabaseClient
} from "@/lib/database/database";

export type RegistrationStep =
  | "pending_email"
  | "pending_phone"
  | "complete"
  | "cancelled";

export type PendingRegistrationStep = Extract<
  RegistrationStep,
  "pending_email" | "pending_phone"
>;

export type RegistrationFlow = {
  flowId: string;
  accountId: string;
  tokenHash: string;
  currentStep: RegistrationStep;
  expiresAt: string;
  completedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SandboxDelivery = {
  deliveryId: string;
  challengeId: string;
  channel: OtpChannel;
  destinationHash: string;
  deliveryHint: string;
  encryptedCode: string;
  createdAt: string;
  openedAt: string | null;
};

type DatabaseTimestamp = string | Date;

type RegistrationFlowRow = {
  flow_id: string;
  account_id: string;
  token_hash: string;
  current_step: RegistrationStep;
  expires_at: DatabaseTimestamp;
  completed_at: DatabaseTimestamp | null;
  cancelled_at: DatabaseTimestamp | null;
  created_at: DatabaseTimestamp;
  updated_at: DatabaseTimestamp;
};

type OtpChallengeRow = {
  challenge_id: string;
  account_id: string | null;
  purpose: OtpPurpose;
  channel: OtpChannel;
  destination_hash: string;
  delivery_hint: string;
  code_hash: string;
  attempts_remaining: number;
  resend_available_at: DatabaseTimestamp;
  expires_at: DatabaseTimestamp;
  consumed_at: DatabaseTimestamp | null;
  invalidated_at: DatabaseTimestamp | null;
  created_at: DatabaseTimestamp;
};

type SandboxDeliveryRow = {
  delivery_id: string;
  challenge_id: string;
  channel: OtpChannel;
  destination_hash: string;
  delivery_hint: string;
  encrypted_code: string;
  created_at: DatabaseTimestamp;
  opened_at: DatabaseTimestamp | null;
};

const FLOW_COLUMNS = `
  flow_id,
  account_id,
  token_hash,
  current_step,
  expires_at,
  completed_at,
  cancelled_at,
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

const DELIVERY_COLUMNS = `
  deliveries.delivery_id AS delivery_id,
  deliveries.challenge_id AS challenge_id,
  deliveries.channel AS channel,
  deliveries.destination_hash AS destination_hash,
  deliveries.delivery_hint AS delivery_hint,
  deliveries.encrypted_code AS encrypted_code,
  deliveries.created_at AS created_at,
  deliveries.opened_at AS opened_at
`;

function timestamp(value: DatabaseTimestamp): string {
  return value instanceof Date ? value.toISOString() : value;
}

function nullableTimestamp(value: DatabaseTimestamp | null): string | null {
  return value === null ? null : timestamp(value);
}

function flowFromRow(row: RegistrationFlowRow): RegistrationFlow {
  return {
    flowId: row.flow_id,
    accountId: row.account_id,
    tokenHash: row.token_hash,
    currentStep: row.current_step,
    expiresAt: timestamp(row.expires_at),
    completedAt: nullableTimestamp(row.completed_at),
    cancelledAt: nullableTimestamp(row.cancelled_at),
    createdAt: timestamp(row.created_at),
    updatedAt: timestamp(row.updated_at)
  };
}

function otpFromRow(row: OtpChallengeRow): AuthOtpChallenge {
  return {
    challengeId: row.challenge_id,
    accountId: row.account_id,
    purpose: row.purpose,
    channel: row.channel,
    destinationHash: row.destination_hash,
    deliveryHint: row.delivery_hint,
    codeHash: row.code_hash,
    attemptsRemaining: row.attempts_remaining,
    resendAvailableAt: timestamp(row.resend_available_at),
    expiresAt: timestamp(row.expires_at),
    consumedAt: nullableTimestamp(row.consumed_at),
    invalidatedAt: nullableTimestamp(row.invalidated_at),
    createdAt: timestamp(row.created_at)
  };
}

function deliveryFromRow(row: SandboxDeliveryRow): SandboxDelivery {
  return {
    deliveryId: row.delivery_id,
    challengeId: row.challenge_id,
    channel: row.channel,
    destinationHash: row.destination_hash,
    deliveryHint: row.delivery_hint,
    encryptedCode: row.encrypted_code,
    createdAt: timestamp(row.created_at),
    openedAt: nullableTimestamp(row.opened_at)
  };
}

export class WorkerRegistrationRepository {
  readonly authentication: AuthenticationRepository;

  constructor(private readonly database: DatabaseClient) {
    this.authentication = new AuthenticationRepository(database);
  }

  async transaction<T>(
    operation: (repository: WorkerRegistrationRepository) => Promise<T>
  ): Promise<T> {
    return this.database.transaction((client) =>
      operation(new WorkerRegistrationRepository(client))
    );
  }

  async findAccountByPhone(phone: string): Promise<AuthAccount | null> {
    const result = await this.database.query<{ account_id: string }>(
      `SELECT account_id
       FROM auth_accounts
       WHERE phone_e164 = $1`,
      [phone]
    );
    const accountId = result.rows[0]?.account_id;
    return accountId
      ? this.authentication.findAccountById(accountId)
      : null;
  }

  async findMatchingPendingWorker(input: {
    email: string;
    phone: string;
  }): Promise<AuthAccount | null> {
    const result = await this.database.query<{ account_id: string }>(
      `SELECT accounts.account_id
       FROM auth_accounts AS accounts
       INNER JOIN auth_account_roles AS roles
         ON roles.account_id = accounts.account_id
        AND roles.role = 'worker'
       WHERE accounts.email_normalized = $1
         AND accounts.phone_e164 = $2
         AND accounts.account_status IN ('pending_email', 'pending_phone')`,
      [input.email, input.phone]
    );
    const accountId = result.rows[0]?.account_id;
    return accountId
      ? this.authentication.findAccountById(accountId)
      : null;
  }

  async replacePendingRegistrationDetails(input: {
    accountId: string;
    displayName: string;
    passwordHash: string;
    now: string;
  }): Promise<boolean> {
    const result = await this.database.query(
      `UPDATE auth_accounts
       SET display_name = $2,
           password_hash = $3,
           password_set_at = $4,
           updated_at = $4
       WHERE account_id = $1
         AND account_status = 'pending_email'`,
      [input.accountId, input.displayName, input.passwordHash, input.now]
    );
    return result.affectedRows === 1;
  }

  async deleteUnactivatedAccount(accountId: string): Promise<boolean> {
    const result = await this.database.query(
      `DELETE FROM auth_accounts AS accounts
       WHERE accounts.account_id = $1
         AND accounts.account_status IN ('pending_email', 'pending_phone')
         AND NOT EXISTS (
           SELECT 1
           FROM auth_sessions AS sessions
           WHERE sessions.account_id = accounts.account_id
         )`,
      [accountId]
    );
    return result.affectedRows === 1;
  }

  async createOrRotateFlow(input: {
    flowId: string;
    accountId: string;
    tokenHash: string;
    currentStep: PendingRegistrationStep;
    expiresAt: string;
    now: string;
  }): Promise<RegistrationFlow> {
    const updated = await this.database.query<RegistrationFlowRow>(
      `UPDATE auth_registration_flows
       SET flow_id = $2,
           token_hash = $3,
           current_step = $4,
           expires_at = $5,
           completed_at = NULL,
           cancelled_at = NULL,
           updated_at = $6
       WHERE account_id = $1
         AND current_step IN ('pending_email', 'pending_phone')
       RETURNING ${FLOW_COLUMNS}`,
      [
        input.accountId,
        input.flowId,
        input.tokenHash,
        input.currentStep,
        input.expiresAt,
        input.now
      ]
    );
    if (updated.rows[0]) {
      return flowFromRow(updated.rows[0]);
    }

    const inserted = await this.database.query<RegistrationFlowRow>(
      `INSERT INTO auth_registration_flows (
         flow_id,
         account_id,
         token_hash,
         current_step,
         expires_at,
         created_at,
         updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $6)
       RETURNING ${FLOW_COLUMNS}`,
      [
        input.flowId,
        input.accountId,
        input.tokenHash,
        input.currentStep,
        input.expiresAt,
        input.now
      ]
    );
    const row = inserted.rows[0];
    if (!row) {
      throw new Error("Registration flow insert returned no row.");
    }
    return flowFromRow(row);
  }

  async findFlowByTokenHash(
    tokenHash: string,
    now: string
  ): Promise<RegistrationFlow | null> {
    const result = await this.database.query<RegistrationFlowRow>(
      `SELECT ${FLOW_COLUMNS}
       FROM auth_registration_flows
       WHERE token_hash = $1
         AND expires_at > $2
         AND current_step IN ('pending_email', 'pending_phone', 'complete')`,
      [tokenHash, now]
    );
    return result.rows[0] ? flowFromRow(result.rows[0]) : null;
  }

  async findFlowForUpdate(
    tokenHash: string
  ): Promise<RegistrationFlow | null> {
    const result = await this.database.query<RegistrationFlowRow>(
      `SELECT ${FLOW_COLUMNS}
       FROM auth_registration_flows
       WHERE token_hash = $1
       FOR UPDATE`,
      [tokenHash]
    );
    return result.rows[0] ? flowFromRow(result.rows[0]) : null;
  }

  async advanceFlow(input: {
    accountId: string;
    from: PendingRegistrationStep;
    to: "pending_phone" | "complete";
    now: string;
  }): Promise<boolean> {
    const result = await this.database.query(
      `UPDATE auth_registration_flows
       SET current_step = $3,
           completed_at = CASE
             WHEN $3 = 'complete' THEN $4::timestamptz
             ELSE NULL::timestamptz
           END,
           updated_at = $4::timestamptz
       WHERE account_id = $1
         AND current_step = $2`,
      [input.accountId, input.from, input.to, input.now]
    );
    return result.affectedRows === 1;
  }

  async findLatestActiveChallengeForUpdate(input: {
    accountId: string;
    purpose: OtpPurpose;
  }): Promise<AuthOtpChallenge | null> {
    const result = await this.database.query<OtpChallengeRow>(
      `SELECT ${OTP_COLUMNS}
       FROM auth_otp_challenges
       WHERE account_id = $1
         AND purpose = $2
         AND consumed_at IS NULL
         AND invalidated_at IS NULL
       ORDER BY created_at DESC
       LIMIT 1
       FOR UPDATE`,
      [input.accountId, input.purpose]
    );
    return result.rows[0] ? otpFromRow(result.rows[0]) : null;
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

  async findLatestSandboxDelivery(input: {
    channel: OtpChannel;
    destinationHash: string;
  }): Promise<SandboxDelivery | null> {
    const result = await this.database.query<SandboxDeliveryRow>(
      `SELECT ${DELIVERY_COLUMNS}
       FROM auth_sandbox_deliveries AS deliveries
       INNER JOIN auth_otp_challenges AS challenges
         ON challenges.challenge_id = deliveries.challenge_id
       WHERE deliveries.channel = $1
         AND deliveries.destination_hash = $2
         AND challenges.consumed_at IS NULL
         AND challenges.invalidated_at IS NULL
         AND challenges.expires_at > CURRENT_TIMESTAMP
         AND challenges.attempts_remaining > 0
       ORDER BY deliveries.created_at DESC
       LIMIT 1`,
      [input.channel, input.destinationHash]
    );
    return result.rows[0] ? deliveryFromRow(result.rows[0]) : null;
  }

  async markSandboxDeliveryOpened(input: {
    deliveryId: string;
    openedAt: string;
  }): Promise<void> {
    await this.database.query(
      `UPDATE auth_sandbox_deliveries
       SET opened_at = COALESCE(opened_at, $2)
       WHERE delivery_id = $1`,
      [input.deliveryId, input.openedAt]
    );
  }

  async consumeRegistrationStartRateLimit(input: {
    bucketKey: string;
    now: string;
    resetBefore: string;
  }): Promise<number> {
    const result = await this.database.query<{ attempt_count: number }>(
      `INSERT INTO auth_rate_limit_buckets (
         action,
         bucket_key,
         window_started_at,
         attempt_count,
         updated_at
       ) VALUES ('worker_registration_start', $1, $2, 1, $2)
       ON CONFLICT (action, bucket_key) DO UPDATE
       SET window_started_at = CASE
             WHEN auth_rate_limit_buckets.window_started_at <= $3 THEN $2
             ELSE auth_rate_limit_buckets.window_started_at
           END,
           attempt_count = CASE
             WHEN auth_rate_limit_buckets.window_started_at <= $3 THEN 1
             ELSE auth_rate_limit_buckets.attempt_count + 1
           END,
           updated_at = $2
       RETURNING attempt_count`,
      [input.bucketKey, input.now, input.resetBefore]
    );
    const count = result.rows[0]?.attempt_count;
    if (!Number.isSafeInteger(count)) {
      throw new Error("Registration rate-limit update returned no count.");
    }
    return count;
  }
}

export async function getWorkerRegistrationRepository(): Promise<WorkerRegistrationRepository> {
  return new WorkerRegistrationRepository(await getDatabaseClient());
}
