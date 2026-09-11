import "server-only";

import {
  createIdentifier,
  hashOpaqueValue,
  normalizeEmail
} from "../auth/auth-domain";
import { bindTrustedAuditActor } from "../audit/audit-domain";
import { DatabaseAuditRepository } from "../audit/audit-repository";
import type { AuthorizationPrincipal } from "../authorization/authorization-context-domain";
import type { DatabaseClient } from "../database/database";
import {
  CompanyWorkforceAccessError,
  CompanyWorkforceConflictError,
  CompanyWorkforceSecretError,
  type CompanyWorkerLinkRecord,
  type CompanyWorkforcePaymentResponsibility
} from "./company-workforce-domain";

const INVITATION_SECRET_CONTEXT = "hse-company-worker-invitation-v1";
const REGISTRATION_CODE_SECRET_CONTEXT = "hse-company-registration-code-v1";

export type CompanyWorkforceRegistrationResource = Readonly<{
  kind: "invitation" | "code";
  resourceId: string;
}>;

export type CompanyWorkforceCompletedRegistrationBinding =
  CompanyWorkforceRegistrationResource &
    Readonly<{
      registrationTokenHash: string;
    }>;

type InvitationRow = {
  invitation_id: string;
  tenant_id: string;
  email_normalized: string;
  invitation_status: "pending" | "accepted" | "revoked" | "expired";
  site_id: string | null;
  department_id: string | null;
  payment_responsibility: CompanyWorkforcePaymentResponsibility;
  assessment_reference: string | null;
  invited_by_membership_id: string;
  expires_at: string | Date;
};

type CodeRow = {
  code_id: string;
  tenant_id: string;
  code_status: "active" | "revoked" | "expired" | "exhausted";
  usage_limit: number;
  usage_count: number;
  site_id: string | null;
  department_id: string | null;
  payment_responsibility: CompanyWorkforcePaymentResponsibility;
  assessment_reference: string | null;
  created_by_membership_id: string;
  expires_at: string | Date;
};

type LinkRow = {
  link_id: string;
  tenant_id: string;
  worker_account_id: string;
  permanent_worker_id: string | null;
  link_source: "invitation" | "code" | "permanent_worker_id";
  link_status: "pending_worker_acceptance" | "active" | "revoked";
  site_id: string | null;
  department_id: string | null;
  payment_responsibility: CompanyWorkforcePaymentResponsibility;
  assessment_reference: string | null;
  worker_accepted_at: string | Date | null;
  activated_at: string | Date | null;
  revoked_at: string | Date | null;
};

function timestamp(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function nullableTimestamp(value: string | Date | null): string | null {
  return value === null ? null : timestamp(value);
}

function linkRecord(row: LinkRow): CompanyWorkerLinkRecord {
  return Object.freeze({
    linkId: row.link_id,
    tenantId: row.tenant_id,
    workerAccountId: row.worker_account_id,
    permanentWorkerId: row.permanent_worker_id,
    source: row.link_source,
    status: row.link_status,
    siteId: row.site_id,
    departmentId: row.department_id,
    paymentResponsibility: row.payment_responsibility,
    assessmentReference: row.assessment_reference,
    workerAcceptedAt: nullableTimestamp(row.worker_accepted_at),
    activatedAt: nullableTimestamp(row.activated_at),
    revokedAt: nullableTimestamp(row.revoked_at)
  });
}

async function assertVerifiedCompany(
  database: DatabaseClient,
  tenantId: string
): Promise<void> {
  const result = await database.query<{ case_status: string }>(
    `SELECT cases.case_status
     FROM company_verification_cases AS cases
     JOIN platform_tenants AS tenants
       ON tenants.tenant_id=cases.tenant_id
     WHERE cases.tenant_id=$1
       AND tenants.tenant_status='active'
     FOR UPDATE OF cases, tenants`,
    [tenantId]
  );
  if (result.rows[0]?.case_status !== "verified") {
    throw new CompanyWorkforceAccessError();
  }
}

async function liveWorker(
  database: DatabaseClient,
  principal: AuthorizationPrincipal,
  now: Date
): Promise<{ accountId: string; email: string }> {
  if (
    principal.activeRole !== "worker" ||
    principal.accountStatus !== "active" ||
    principal.tenantMembership !== null
  ) {
    throw new CompanyWorkforceAccessError();
  }
  const result = await database.query<{
    account_id: string;
    email_normalized: string;
  }>(
    `SELECT accounts.account_id, accounts.email_normalized
     FROM auth_sessions AS sessions
     JOIN auth_accounts AS accounts
       ON accounts.account_id=sessions.account_id
     JOIN auth_account_roles AS roles
       ON roles.account_id=accounts.account_id
      AND roles.role='worker'
     WHERE sessions.session_id=$1
       AND sessions.account_id=$2
       AND sessions.active_role='worker'
       AND sessions.revoked_at IS NULL
       AND sessions.expires_at>$3::timestamptz
       AND accounts.account_status='active'
     FOR UPDATE OF sessions, accounts`,
    [principal.sessionId, principal.accountId, now.toISOString()]
  );
  const row = result.rows[0];
  if (!row || row.account_id !== principal.accountId) {
    throw new CompanyWorkforceAccessError();
  }
  return { accountId: row.account_id, email: row.email_normalized };
}

async function assertCompletedRegistrationFlow(
  database: DatabaseClient,
  workerAccountId: string,
  registrationTokenHash: string,
  now: Date
): Promise<void> {
  const result = await database.query<{
    account_id: string;
    current_step: string;
    completed_at: string | Date | null;
    expires_at: string | Date;
  }>(
    `SELECT account_id,current_step,completed_at,expires_at
     FROM auth_registration_flows
     WHERE token_hash=$1
     FOR UPDATE`,
    [registrationTokenHash]
  );
  const flow = result.rows[0];
  if (
    !flow ||
    flow.account_id !== workerAccountId ||
    flow.current_step !== "complete" ||
    flow.completed_at === null ||
    Date.parse(timestamp(flow.expires_at)) <= now.getTime()
  ) {
    throw new CompanyWorkforceAccessError();
  }
}

async function existingLinkByInvitation(
  database: DatabaseClient,
  invitationId: string,
  workerAccountId: string
): Promise<LinkRow | null> {
  const result = await database.query<LinkRow>(
    `SELECT link_id,tenant_id,worker_account_id,permanent_worker_id,
            link_source,link_status,site_id,department_id,
            payment_responsibility,assessment_reference,
            worker_accepted_at,activated_at,revoked_at
     FROM company_worker_links
     WHERE invitation_id=$1 AND worker_account_id=$2
     FOR UPDATE`,
    [invitationId, workerAccountId]
  );
  return result.rows[0] ?? null;
}

async function existingLinkByCode(
  database: DatabaseClient,
  codeId: string,
  workerAccountId: string
): Promise<LinkRow | null> {
  const result = await database.query<LinkRow>(
    `SELECT link_id,tenant_id,worker_account_id,permanent_worker_id,
            link_source,link_status,site_id,department_id,
            payment_responsibility,assessment_reference,
            worker_accepted_at,activated_at,revoked_at
     FROM company_worker_links
     WHERE code_id=$1 AND worker_account_id=$2
     FOR UPDATE`,
    [codeId, workerAccountId]
  );
  return result.rows[0] ?? null;
}

async function existingLiveCompanyLink(
  database: DatabaseClient,
  tenantId: string,
  workerAccountId: string
): Promise<LinkRow | null> {
  const result = await database.query<LinkRow>(
    `SELECT link_id,tenant_id,worker_account_id,permanent_worker_id,
            link_source,link_status,site_id,department_id,
            payment_responsibility,assessment_reference,
            worker_accepted_at,activated_at,revoked_at
     FROM company_worker_links
     WHERE tenant_id=$1
       AND worker_account_id=$2
       AND link_status IN ('pending_worker_acceptance','active')
     FOR UPDATE`,
    [tenantId, workerAccountId]
  );
  return result.rows[0] ?? null;
}

export class CompanyWorkforceRegistrationService {
  constructor(
    private readonly database: DatabaseClient,
    private readonly pepper: string,
    private readonly now: () => Date = () => new Date()
  ) {
    if (pepper.length < 32) {
      throw new Error("Company workforce registration pepper must contain at least 32 characters.");
    }
  }

  async prepareInvitation(rawToken: string): Promise<CompanyWorkforceRegistrationResource> {
    const token = rawToken.trim();
    if (token.length < 24) throw new CompanyWorkforceSecretError();
    const tokenHash = hashOpaqueValue(token, this.pepper, INVITATION_SECRET_CONTEXT);
    const now = this.now();
    const result = await this.database.query<{ invitation_id: string }>(
      `SELECT invitations.invitation_id
       FROM company_worker_invitations AS invitations
       JOIN company_verification_cases AS cases
         ON cases.tenant_id=invitations.tenant_id
       JOIN platform_tenants AS tenants
         ON tenants.tenant_id=invitations.tenant_id
       WHERE invitations.token_hash=$1
         AND invitations.invitation_status='pending'
         AND invitations.expires_at>$2::timestamptz
         AND cases.case_status='verified'
         AND tenants.tenant_status='active'`,
      [tokenHash, now.toISOString()]
    );
    const invitationId = result.rows[0]?.invitation_id;
    if (!invitationId) throw new CompanyWorkforceSecretError();
    return Object.freeze({ kind: "invitation", resourceId: invitationId });
  }

  async prepareRegistrationCode(rawCode: string): Promise<CompanyWorkforceRegistrationResource> {
    const code = rawCode.trim();
    if (code.length < 24) throw new CompanyWorkforceSecretError();
    const codeHash = hashOpaqueValue(code, this.pepper, REGISTRATION_CODE_SECRET_CONTEXT);
    const now = this.now();
    const result = await this.database.query<{ code_id: string }>(
      `SELECT codes.code_id
       FROM company_registration_codes AS codes
       JOIN company_verification_cases AS cases
         ON cases.tenant_id=codes.tenant_id
       JOIN platform_tenants AS tenants
         ON tenants.tenant_id=codes.tenant_id
       WHERE codes.code_hash=$1
         AND codes.code_status='active'
         AND codes.usage_count<codes.usage_limit
         AND codes.expires_at>$2::timestamptz
         AND cases.case_status='verified'
         AND tenants.tenant_status='active'`,
      [codeHash, now.toISOString()]
    );
    const codeId = result.rows[0]?.code_id;
    if (!codeId) throw new CompanyWorkforceSecretError();
    return Object.freeze({ kind: "code", resourceId: codeId });
  }

  async assertRegistrationEmail(
    resource: CompanyWorkforceRegistrationResource,
    emailInput: string
  ): Promise<void> {
    if (resource.kind !== "invitation") return;
    let email: string;
    try {
      email = normalizeEmail(emailInput);
    } catch {
      throw new CompanyWorkforceAccessError();
    }
    const now = this.now();
    const result = await this.database.query<{ email_normalized: string }>(
      `SELECT invitations.email_normalized
       FROM company_worker_invitations AS invitations
       JOIN company_verification_cases AS cases
         ON cases.tenant_id=invitations.tenant_id
       JOIN platform_tenants AS tenants
         ON tenants.tenant_id=invitations.tenant_id
       WHERE invitations.invitation_id=$1
         AND invitations.invitation_status='pending'
         AND invitations.expires_at>$2::timestamptz
         AND cases.case_status='verified'
         AND tenants.tenant_status='active'`,
      [resource.resourceId, now.toISOString()]
    );
    if (result.rows[0]?.email_normalized !== email) {
      throw new CompanyWorkforceAccessError();
    }
  }

  async completeBinding(
    principal: AuthorizationPrincipal,
    binding: CompanyWorkforceCompletedRegistrationBinding
  ): Promise<CompanyWorkerLinkRecord> {
    if (!binding.registrationTokenHash.trim() || !binding.resourceId.trim()) {
      throw new CompanyWorkforceAccessError();
    }
    const now = this.now();
    return this.database.transaction(async (database) => {
      const worker = await liveWorker(database, principal, now);
      await assertCompletedRegistrationFlow(
        database,
        worker.accountId,
        binding.registrationTokenHash,
        now
      );
      return binding.kind === "invitation"
        ? this.completeInvitation(database, principal, worker, binding.resourceId, now)
        : this.completeCode(database, principal, worker, binding.resourceId, now);
    });
  }

  async completePreparedInvitation(
  principal: AuthorizationPrincipal,
  resourceId: string
): Promise<CompanyWorkerLinkRecord> {
  const invitationId = resourceId.trim();
  if (!invitationId) throw new CompanyWorkforceAccessError();
  const now = this.now();
  return this.database.transaction(async (database) => {
    const worker = await liveWorker(database, principal, now);
    return this.completeInvitation(
      database,
      principal,
      worker,
      invitationId,
      now
    );
  });
}

  private async completeInvitation(
    database: DatabaseClient,
    principal: AuthorizationPrincipal,
    worker: { accountId: string; email: string },
    invitationId: string,
    now: Date
  ): Promise<CompanyWorkerLinkRecord> {
    const invitationResult = await database.query<InvitationRow>(
      `SELECT invitation_id,tenant_id,email_normalized,invitation_status,
              site_id,department_id,payment_responsibility,assessment_reference,
              invited_by_membership_id,expires_at
       FROM company_worker_invitations
       WHERE invitation_id=$1
       FOR UPDATE`,
      [invitationId]
    );
    const invitation = invitationResult.rows[0];
    if (!invitation) throw new CompanyWorkforceAccessError();
    const existing = await existingLinkByInvitation(database, invitationId, worker.accountId);
    if (invitation.invitation_status === "accepted" && existing) {
      return linkRecord(existing);
    }
    if (
      invitation.invitation_status !== "pending" ||
      invitation.email_normalized !== worker.email ||
      Date.parse(timestamp(invitation.expires_at)) <= now.getTime()
    ) {
      throw new CompanyWorkforceAccessError();
    }
    await assertVerifiedCompany(database, invitation.tenant_id);
    const live = await existingLiveCompanyLink(database, invitation.tenant_id, worker.accountId);
    if (live) throw new CompanyWorkforceConflictError("Worker is already linked to this Company.");

    const linkId = createIdentifier("company_worker_link");
    const nowIso = now.toISOString();
    const inserted = await database.query<LinkRow>(
      `INSERT INTO company_worker_links
        (link_id,tenant_id,worker_account_id,permanent_worker_id,
         link_source,invitation_id,code_id,link_status,
         site_id,department_id,payment_responsibility,assessment_reference,
         requested_by_membership_id,worker_accepted_at,activated_at,created_at,updated_at)
       VALUES ($1,$2,$3,NULL,'invitation',$4,NULL,'active',$5,$6,$7,$8,$9,$10,$10,$10,$10)
       RETURNING link_id,tenant_id,worker_account_id,permanent_worker_id,
                 link_source,link_status,site_id,department_id,
                 payment_responsibility,assessment_reference,
                 worker_accepted_at,activated_at,revoked_at`,
      [
        linkId,
        invitation.tenant_id,
        worker.accountId,
        invitation.invitation_id,
        invitation.site_id,
        invitation.department_id,
        invitation.payment_responsibility,
        invitation.assessment_reference,
        invitation.invited_by_membership_id,
        nowIso
      ]
    );
    await database.query(
      `UPDATE company_worker_invitations
       SET invitation_status='accepted',accepted_by_worker_account_id=$2,
           accepted_at=$3,updated_at=$3
       WHERE invitation_id=$1 AND invitation_status='pending'`,
      [invitation.invitation_id, worker.accountId, nowIso]
    );
    const audit = new DatabaseAuditRepository(Promise.resolve(database));
    await audit.append(bindTrustedAuditActor(principal), {
      action: "company_workforce.invitation.accepted",
      outcome: "succeeded",
      target: { type: "resource", reference: invitation.invitation_id },
      metadata: { tenantId: invitation.tenant_id, linkId, registrationHandoff: true }
    });
    const row = inserted.rows[0];
    if (!row) throw new CompanyWorkforceConflictError();
    return linkRecord(row);
  }

  private async completeCode(
    database: DatabaseClient,
    principal: AuthorizationPrincipal,
    worker: { accountId: string; email: string },
    codeId: string,
    now: Date
  ): Promise<CompanyWorkerLinkRecord> {
    const codeResult = await database.query<CodeRow>(
      `SELECT code_id,tenant_id,code_status,usage_limit,usage_count,
              site_id,department_id,payment_responsibility,assessment_reference,
              created_by_membership_id,expires_at
       FROM company_registration_codes
       WHERE code_id=$1
       FOR UPDATE`,
      [codeId]
    );
    const code = codeResult.rows[0];
    if (!code) throw new CompanyWorkforceAccessError();
    const existing = await existingLinkByCode(database, codeId, worker.accountId);
    if (existing) return linkRecord(existing);
    if (
      code.code_status !== "active" ||
      code.usage_count >= code.usage_limit ||
      Date.parse(timestamp(code.expires_at)) <= now.getTime()
    ) {
      throw new CompanyWorkforceAccessError();
    }
    await assertVerifiedCompany(database, code.tenant_id);
    const live = await existingLiveCompanyLink(database, code.tenant_id, worker.accountId);
    if (live) throw new CompanyWorkforceConflictError("Worker is already linked to this Company.");

    const nextUsage = code.usage_count + 1;
    const nowIso = now.toISOString();
    await database.query(
      `UPDATE company_registration_codes
       SET usage_count=$2,
           code_status=CASE WHEN $2=usage_limit THEN 'exhausted' ELSE 'active' END,
           exhausted_at=CASE WHEN $2=usage_limit THEN $3::timestamptz ELSE NULL END,
           updated_at=$3
       WHERE code_id=$1`,
      [code.code_id, nextUsage, nowIso]
    );
    const linkId = createIdentifier("company_worker_link");
    const inserted = await database.query<LinkRow>(
      `INSERT INTO company_worker_links
        (link_id,tenant_id,worker_account_id,permanent_worker_id,
         link_source,invitation_id,code_id,link_status,
         site_id,department_id,payment_responsibility,assessment_reference,
         requested_by_membership_id,worker_accepted_at,activated_at,created_at,updated_at)
       VALUES ($1,$2,$3,NULL,'code',NULL,$4,'active',$5,$6,$7,$8,$9,$10,$10,$10,$10)
       RETURNING link_id,tenant_id,worker_account_id,permanent_worker_id,
                 link_source,link_status,site_id,department_id,
                 payment_responsibility,assessment_reference,
                 worker_accepted_at,activated_at,revoked_at`,
      [
        linkId,
        code.tenant_id,
        worker.accountId,
        code.code_id,
        code.site_id,
        code.department_id,
        code.payment_responsibility,
        code.assessment_reference,
        code.created_by_membership_id,
        nowIso
      ]
    );
    const audit = new DatabaseAuditRepository(Promise.resolve(database));
    await audit.append(bindTrustedAuditActor(principal), {
      action: "company_workforce.code.redeemed",
      outcome: "succeeded",
      target: { type: "resource", reference: code.code_id },
      metadata: {
        tenantId: code.tenant_id,
        linkId,
        usageCount: nextUsage,
        registrationHandoff: true
      }
    });
    const row = inserted.rows[0];
    if (!row) throw new CompanyWorkforceConflictError();
    return linkRecord(row);
  }
}
