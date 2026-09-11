import "server-only";

import type { AuthOtpChallenge } from "../auth/auth-repository";
import { AuthenticationRepository } from "../auth/auth-repository";
import { AuthAccessRepository, type MfaFactor } from "../auth/auth-access-repository";
import type { OtpChannel, OtpPurpose } from "../auth/auth-domain";
import { getDatabaseClient, type DatabaseClient } from "../database/database";

export type CompanyRegistrationStep =
  | "pending_email"
  | "pending_mfa"
  | "complete"
  | "cancelled";

export type CompanyRegistrationFlow = Readonly<{
  flowId: string;
  accountId: string;
  tenantId: string;
  membershipId: string;
  caseId: string;
  factorId: string;
  tokenHash: string;
  currentStep: CompanyRegistrationStep;
  expiresAt: string;
  completedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
}>;

type DatabaseTimestamp = string | Date;

type FlowRow = {
  flow_id: string;
  account_id: string;
  tenant_id: string;
  membership_id: string;
  case_id: string;
  factor_id: string;
  token_hash: string;
  current_step: CompanyRegistrationStep;
  expires_at: DatabaseTimestamp;
  completed_at: DatabaseTimestamp | null;
  cancelled_at: DatabaseTimestamp | null;
  created_at: DatabaseTimestamp;
  updated_at: DatabaseTimestamp;
};

type OtpRow = {
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

const FLOW_COLUMNS = `
  flow_id, account_id, tenant_id, membership_id, case_id, factor_id,
  token_hash, current_step, expires_at, completed_at, cancelled_at,
  created_at, updated_at
`;

const OTP_COLUMNS = `
  challenge_id, account_id, purpose, channel, destination_hash,
  delivery_hint, code_hash, attempts_remaining, resend_available_at,
  expires_at, consumed_at, invalidated_at, created_at
`;

function timestamp(value: DatabaseTimestamp): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function optionalTimestamp(value: DatabaseTimestamp | null): string | null {
  return value === null ? null : timestamp(value);
}

function flowFromRow(row: FlowRow): CompanyRegistrationFlow {
  return Object.freeze({
    flowId: row.flow_id,
    accountId: row.account_id,
    tenantId: row.tenant_id,
    membershipId: row.membership_id,
    caseId: row.case_id,
    factorId: row.factor_id,
    tokenHash: row.token_hash,
    currentStep: row.current_step,
    expiresAt: timestamp(row.expires_at),
    completedAt: optionalTimestamp(row.completed_at),
    cancelledAt: optionalTimestamp(row.cancelled_at),
    createdAt: timestamp(row.created_at),
    updatedAt: timestamp(row.updated_at)
  });
}

function otpFromRow(row: OtpRow): AuthOtpChallenge {
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
    consumedAt: optionalTimestamp(row.consumed_at),
    invalidatedAt: optionalTimestamp(row.invalidated_at),
    createdAt: timestamp(row.created_at)
  };
}

export class CompanyRegistrationRepository {
  readonly authentication: AuthenticationRepository;
  readonly access: AuthAccessRepository;

  constructor(private readonly database: DatabaseClient) {
    this.authentication = new AuthenticationRepository(database);
    this.access = new AuthAccessRepository(database);
  }

  async transaction<T>(
    operation: (repository: CompanyRegistrationRepository) => Promise<T>
  ): Promise<T> {
    return this.database.transaction((client) =>
      operation(new CompanyRegistrationRepository(client))
    );
  }

  async consumeStartRateLimit(input: {
    bucketKey: string;
    now: string;
    resetBefore: string;
  }): Promise<number> {
    const result = await this.database.query<{ attempt_count: number }>(
      `INSERT INTO auth_rate_limit_buckets (
         action, bucket_key, window_started_at, attempt_count, updated_at
       ) VALUES ('company_registration_start', $1, $2, 1, $2)
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
      throw new Error("Company registration rate limit returned no count.");
    }
    return count;
  }

  async createTenantFoundation(input: {
    tenantId: string;
    membershipId: string;
    accountId: string;
    displayName: string;
    caseId: string;
    versionId: string;
    legalName: string;
    tradingName: string;
    registrationNumber: string;
    country: string;
    industry: string;
    companySize: string;
    website: string;
    authorizedRepresentative: string;
    businessEmail: string;
    businessPhone: string;
    termsAcceptedAt: string;
    privacyAcceptedAt: string;
    registrationFingerprint: string;
    legalNameFingerprint: string;
    now: string;
  }): Promise<void> {
    await this.database.query(
      `INSERT INTO platform_tenants (
         tenant_id, tenant_type, display_name, tenant_status, created_at, updated_at
       ) VALUES ($1, 'company', $2, 'pending', $3, $3)`,
      [input.tenantId, input.displayName, input.now]
    );
    await this.database.query(
      `INSERT INTO auth_tenant_memberships (
         membership_id, tenant_id, account_id, portal_role,
         membership_role, membership_status, created_at, updated_at
       ) VALUES ($1, $2, $3, 'company', 'owner', 'invited', $4, $4)`,
      [input.membershipId, input.tenantId, input.accountId, input.now]
    );
    await this.database.query(
      `INSERT INTO company_verification_cases (
         case_id, tenant_id, owner_account_id, case_status,
         registration_fingerprint, legal_name_fingerprint,
         created_at, updated_at
       ) VALUES ($1, $2, $3, 'draft', $4, $5, $6, $6)`,
      [
        input.caseId,
        input.tenantId,
        input.accountId,
        input.registrationFingerprint,
        input.legalNameFingerprint,
        input.now
      ]
    );
    await this.database.query(
      `INSERT INTO company_verification_versions (
         version_id, case_id, version_number, version_status, draft_revision,
         legal_name, trading_name, registration_number, country, industry,
         company_size, website, authorized_representative,
         business_email_normalized, business_phone_e164,
         terms_accepted_at, privacy_accepted_at,
         created_at, updated_at
       ) VALUES (
         $1, $2, 1, 'draft', 0,
         $3, $4, $5, $6, $7,
         $8, $9, $10,
         $11, $12,
         $13, $14,
         $15, $15
       )`,
      [
        input.versionId,
        input.caseId,
        input.legalName,
        input.tradingName,
        input.registrationNumber,
        input.country,
        input.industry,
        input.companySize,
        input.website,
        input.authorizedRepresentative,
        input.businessEmail,
        input.businessPhone,
        input.termsAcceptedAt,
        input.privacyAcceptedAt,
        input.now
      ]
    );
    const linked = await this.database.query(
      `UPDATE company_verification_cases
       SET current_version_id = $2
       WHERE case_id = $1
         AND current_version_id IS NULL`,
      [input.caseId, input.versionId]
    );
    if (linked.affectedRows !== 1) {
      throw new Error("Company verification initial version link failed.");
    }
  }

  async insertFlow(input: {
    flowId: string;
    accountId: string;
    tenantId: string;
    membershipId: string;
    caseId: string;
    factorId: string;
    tokenHash: string;
    expiresAt: string;
    now: string;
  }): Promise<CompanyRegistrationFlow> {
    const result = await this.database.query<FlowRow>(
      `INSERT INTO company_registration_flows (
         flow_id, account_id, tenant_id, membership_id, case_id, factor_id,
         token_hash, current_step, expires_at, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending_email', $8, $9, $9)
       RETURNING ${FLOW_COLUMNS}`,
      [
        input.flowId,
        input.accountId,
        input.tenantId,
        input.membershipId,
        input.caseId,
        input.factorId,
        input.tokenHash,
        input.expiresAt,
        input.now
      ]
    );
    const row = result.rows[0];
    if (!row) throw new Error("Company registration flow insert returned no row.");
    return flowFromRow(row);
  }

  async findFlowForUpdate(tokenHash: string): Promise<CompanyRegistrationFlow | null> {
    const result = await this.database.query<FlowRow>(
      `SELECT ${FLOW_COLUMNS}
       FROM company_registration_flows
       WHERE token_hash = $1
       FOR UPDATE`,
      [tokenHash]
    );
    return result.rows[0] ? flowFromRow(result.rows[0]) : null;
  }

  async findFlow(tokenHash: string, now: string): Promise<CompanyRegistrationFlow | null> {
    const result = await this.database.query<FlowRow>(
      `SELECT ${FLOW_COLUMNS}
       FROM company_registration_flows
       WHERE token_hash = $1
         AND expires_at > $2
         AND current_step IN ('pending_email', 'pending_mfa', 'complete')`,
      [tokenHash, now]
    );
    return result.rows[0] ? flowFromRow(result.rows[0]) : null;
  }

  async advanceToMfa(input: { flowId: string; now: string }): Promise<boolean> {
    const result = await this.database.query(
      `UPDATE company_registration_flows
       SET current_step = 'pending_mfa', updated_at = $2
       WHERE flow_id = $1
         AND current_step = 'pending_email'`,
      [input.flowId, input.now]
    );
    return result.affectedRows === 1;
  }

  async completeFlow(input: { flowId: string; now: string }): Promise<boolean> {
    const result = await this.database.query(
      `WITH activated_membership AS (
         UPDATE auth_tenant_memberships AS memberships
         SET membership_status = 'active',
             activated_at = $2,
             updated_at = $2
         FROM company_registration_flows AS flows
         WHERE flows.flow_id = $1
           AND flows.current_step = 'pending_mfa'
           AND memberships.membership_id = flows.membership_id
           AND memberships.tenant_id = flows.tenant_id
           AND memberships.account_id = flows.account_id
           AND memberships.portal_role = 'company'
           AND memberships.membership_role = 'owner'
           AND memberships.membership_status = 'invited'
           AND memberships.activated_at IS NULL
         RETURNING memberships.membership_id
       )
       UPDATE company_registration_flows AS flows
       SET current_step = 'complete', completed_at = $2, updated_at = $2
       WHERE flows.flow_id = $1
         AND flows.current_step = 'pending_mfa'
         AND EXISTS (
           SELECT 1
           FROM activated_membership
           WHERE activated_membership.membership_id = flows.membership_id
         )`,
      [input.flowId, input.now]
    );
    return result.affectedRows === 1;
  }

  async findLatestActiveEmailChallengeForUpdate(
    accountId: string
  ): Promise<AuthOtpChallenge | null> {
    const result = await this.database.query<OtpRow>(
      `SELECT ${OTP_COLUMNS}
       FROM auth_otp_challenges
       WHERE account_id = $1
         AND purpose = 'registration_email'
         AND channel = 'email'
         AND consumed_at IS NULL
         AND invalidated_at IS NULL
       ORDER BY created_at DESC
       LIMIT 1
       FOR UPDATE`,
      [accountId]
    );
    return result.rows[0] ? otpFromRow(result.rows[0]) : null;
  }

  async insertSandboxDelivery(input: {
    deliveryId: string;
    challengeId: string;
    destinationHash: string;
    deliveryHint: string;
    encryptedCode: string;
    createdAt: string;
  }): Promise<void> {
    await this.access.insertSandboxDelivery({
      deliveryId: input.deliveryId,
      challengeId: input.challengeId,
      channel: "email",
      destinationHash: input.destinationHash,
      deliveryHint: input.deliveryHint,
      encryptedCode: input.encryptedCode,
      createdAt: input.createdAt
    });
  }

  findMfaFactorForUpdate(factorId: string): Promise<MfaFactor | null> {
    return this.access.findMfaFactorForUpdate(factorId);
  }
}

export async function getCompanyRegistrationRepository(): Promise<CompanyRegistrationRepository> {
  return new CompanyRegistrationRepository(await getDatabaseClient());
}
