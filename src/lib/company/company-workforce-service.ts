import "server-only";

import {
  createIdentifier,
  createOpaqueToken,
  hashOpaqueValue,
  normalizeEmail
} from "../auth/auth-domain";
import type { AuthorizationPrincipal } from "../authorization/authorization-context-domain";
import { runTenantScopedCommand } from "../authorization/tenant-scoped-command-guard";
import {
  bindTrustedAuditActor,
  type AuditAction
} from "../audit/audit-domain";
import { DatabaseAuditRepository } from "../audit/audit-repository";
import type { DatabaseClient } from "../database/database";
import {
  COMPANY_WORKFORCE_MANAGE_PERMISSION,
  COMPANY_WORKFORCE_PAYMENT_RESPONSIBILITIES,
  CompanyWorkforceAccessError,
  CompanyWorkforceConflictError,
  CompanyWorkforceInputError,
  CompanyWorkforceSecretError,
  type BulkInviteWorkerResult,
  type CompanyRegistrationCodeSecret,
  type CompanyWorkerInvitationSecret,
  type CompanyWorkerLinkRecord,
  type CompanyWorkforceDefaults,
  type CompanyWorkforceManagePrincipal,
  type CompanyWorkforcePaymentResponsibility,
  type CreateCompanyRegistrationCodeInput,
  type InviteWorkerInput
} from "./company-workforce-domain";

const INVITATION_SECRET_CONTEXT = "hse-company-worker-invitation-v1";
const REGISTRATION_CODE_SECRET_CONTEXT = "hse-company-registration-code-v1";
const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const INVITATION_RESEND_COOLDOWN_MS = 5 * 60 * 1000;
const MAX_CODE_TTL_MS = 90 * 24 * 60 * 60 * 1000;

export const COMPANY_WORKFORCE_SQL_AUTHORITY = Object.freeze({
  verification: "company_verification_cases",
  permanentWorkerId: "worker_identity_worker_ids",
  invitations: "company_worker_invitations",
  codes: "company_registration_codes",
  links: "company_worker_links"
});

type InvitationRow = {
  invitation_id: string;
  tenant_id: string;
  email_normalized: string;
  invitation_status: "pending" | "accepted" | "revoked" | "expired";
  site_id: string | null;
  department_id: string | null;
  payment_responsibility: CompanyWorkforcePaymentResponsibility;
  assessment_reference: string | null;
  expires_at: string | Date;
  resend_available_at: string | Date;
  resend_count: number;
  accepted_by_worker_account_id: string | null;
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
function addMs(date: Date, milliseconds: number): string {
  return new Date(date.getTime() + milliseconds).toISOString();
}
function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as { code?: unknown }).code === "23505");
}
function knownCompanyError(error: unknown): boolean {
  return error instanceof CompanyWorkforceInputError ||
    error instanceof CompanyWorkforceAccessError ||
    error instanceof CompanyWorkforceConflictError ||
    error instanceof CompanyWorkforceSecretError;
}
function defaults(input: CompanyWorkforceDefaults): CompanyWorkforceDefaults {
  const paymentResponsibility = input.paymentResponsibility;
  if (!COMPANY_WORKFORCE_PAYMENT_RESPONSIBILITIES.includes(paymentResponsibility)) {
    throw new CompanyWorkforceInputError("Payment responsibility must be Company or Worker.");
  }
  const assessmentReference = input.assessmentReference?.trim() || null;
  if (assessmentReference && assessmentReference.length > 120) {
    throw new CompanyWorkforceInputError("Assessment reference is too long.");
  }
  return Object.freeze({
    siteId: input.siteId?.trim() || null,
    departmentId: input.departmentId?.trim() || null,
    paymentResponsibility,
    assessmentReference
  });
}
function workerEmail(value: string): string {
  try { return normalizeEmail(value); }
  catch { throw new CompanyWorkforceInputError("Enter a valid Worker email address."); }
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

export function createCompanyWorkerInvitationSecret(pepper: string): Readonly<{ raw: string; hash: string }> {
  const raw = createOpaqueToken();
  return Object.freeze({ raw, hash: hashOpaqueValue(raw, pepper, INVITATION_SECRET_CONTEXT) });
}
export function createCompanyRegistrationCodeSecret(pepper: string): Readonly<{ raw: string; hash: string }> {
  const raw = createOpaqueToken(24);
  return Object.freeze({ raw, hash: hashOpaqueValue(raw, pepper, REGISTRATION_CODE_SECRET_CONTEXT) });
}

async function assertActiveUnits(database: DatabaseClient, tenantId: string, value: CompanyWorkforceDefaults): Promise<void> {
  if (value.siteId) {
    const site = await database.query(`SELECT 1 FROM company_sites WHERE tenant_id=$1 AND site_id=$2 AND site_status='active' FOR UPDATE`, [tenantId, value.siteId]);
    if (!site.rows[0]) throw new CompanyWorkforceAccessError();
  }
  if (value.departmentId) {
    const department = await database.query(`SELECT 1 FROM company_departments WHERE tenant_id=$1 AND department_id=$2 AND department_status='active' FOR UPDATE`, [tenantId, value.departmentId]);
    if (!department.rows[0]) throw new CompanyWorkforceAccessError();
  }
}

async function assertVerifiedCompany(database: DatabaseClient, tenantId: string): Promise<void> {
  const result = await database.query<{ case_status: string }>(
    `SELECT cases.case_status
     FROM company_verification_cases AS cases
     JOIN platform_tenants AS tenants ON tenants.tenant_id=cases.tenant_id
     WHERE cases.tenant_id=$1 AND tenants.tenant_status='active'
     FOR UPDATE OF cases, tenants`, [tenantId]);
  if (result.rows[0]?.case_status !== "verified") throw new CompanyWorkforceAccessError();
}

export async function expireCompanyWorkforceResources(
  database: DatabaseClient,
  tenantId: string,
  now: Date
): Promise<void> {
  const nowIso = now.toISOString();
  await database.query(
    `UPDATE company_worker_invitations
     SET invitation_status='expired', expired_at=$2, updated_at=$2
     WHERE tenant_id=$1
       AND invitation_status='pending'
       AND expires_at <= $2::timestamptz`,
    [tenantId, nowIso]
  );
  await database.query(
    `UPDATE company_registration_codes
     SET code_status='expired', expired_at=$2, updated_at=$2
     WHERE tenant_id=$1
       AND code_status='active'
       AND expires_at <= $2::timestamptz`,
    [tenantId, nowIso]
  );
}

export async function runVerifiedCompanyWorkforceCommand<Result>(input: {
  database: DatabaseClient;
  principal: CompanyWorkforceManagePrincipal;
  now?: Date;
  operation: (input: { database: DatabaseClient; tenantId: string; membershipId: string }) => Promise<Result>;
}): Promise<Result> {
  return runTenantScopedCommand({
    database: input.database,
    principal: input.principal,
    permission: COMPANY_WORKFORCE_MANAGE_PERMISSION,
    now: input.now,
    operation: async ({ database, scope }) => {
      await assertVerifiedCompany(database, scope.tenantId);
      await expireCompanyWorkforceResources(database, scope.tenantId, input.now ?? new Date());
      return input.operation({ database, tenantId: scope.tenantId, membershipId: scope.membershipId });
    }
  });
}

async function runWorkerCommand<Result>(input: {
  database: DatabaseClient;
  principal: AuthorizationPrincipal;
  now: Date;
  operation: (context: { database: DatabaseClient; workerAccountId: string; email: string }) => Promise<Result>;
}): Promise<Result> {
  const principal = input.principal;
  if (principal.activeRole !== "worker" || principal.tenantMembership !== null || principal.accountStatus !== "active") {
    throw new CompanyWorkforceAccessError();
  }
  return input.database.transaction(async (database) => {
    const live = await database.query<{ account_id: string; email_normalized: string }>(
      `SELECT accounts.account_id, accounts.email_normalized
       FROM auth_sessions AS sessions
       JOIN auth_accounts AS accounts ON accounts.account_id=sessions.account_id
       JOIN auth_account_roles AS roles ON roles.account_id=accounts.account_id AND roles.role='worker'
       WHERE sessions.session_id=$1 AND sessions.account_id=$2 AND sessions.active_role='worker'
         AND sessions.revoked_at IS NULL AND sessions.expires_at>$3::timestamptz
         AND accounts.account_status='active'
       FOR UPDATE OF sessions, accounts`,
      [principal.sessionId, principal.accountId, input.now.toISOString()]
    );
    const row = live.rows[0];
    if (!row || row.account_id !== principal.accountId) throw new CompanyWorkforceAccessError();
    return input.operation({ database, workerAccountId: row.account_id, email: row.email_normalized });
  });
}

async function appendWorkforceAudit(database: DatabaseClient, principal: AuthorizationPrincipal, input: {
  action: AuditAction;
  targetReference: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const audit = new DatabaseAuditRepository(Promise.resolve(database));
  await audit.append(bindTrustedAuditActor(principal), {
    action: input.action,
    outcome: "succeeded",
    target: { type: "resource", reference: input.targetReference },
    metadata: input.metadata ?? {}
  });
}

async function liveLink(database: DatabaseClient, tenantId: string, workerAccountId: string): Promise<LinkRow | null> {
  const result = await database.query<LinkRow>(
    `SELECT link_id,tenant_id,worker_account_id,permanent_worker_id,link_source,link_status,
            site_id,department_id,payment_responsibility,assessment_reference,
            worker_accepted_at,activated_at,revoked_at
     FROM company_worker_links
     WHERE tenant_id=$1 AND worker_account_id=$2 AND link_status IN ('pending_worker_acceptance','active')
     FOR UPDATE`, [tenantId, workerAccountId]);
  return result.rows[0] ?? null;
}
async function findLinkByInvitation(database: DatabaseClient, invitationId: string, workerAccountId: string): Promise<LinkRow | null> {
  const result = await database.query<LinkRow>(
    `SELECT link_id,tenant_id,worker_account_id,permanent_worker_id,link_source,link_status,
            site_id,department_id,payment_responsibility,assessment_reference,
            worker_accepted_at,activated_at,revoked_at
     FROM company_worker_links WHERE invitation_id=$1 AND worker_account_id=$2`, [invitationId, workerAccountId]);
  return result.rows[0] ?? null;
}
async function findLinkByCode(database: DatabaseClient, codeId: string, workerAccountId: string): Promise<LinkRow | null> {
  const result = await database.query<LinkRow>(
    `SELECT link_id,tenant_id,worker_account_id,permanent_worker_id,link_source,link_status,
            site_id,department_id,payment_responsibility,assessment_reference,
            worker_accepted_at,activated_at,revoked_at
     FROM company_worker_links WHERE code_id=$1 AND worker_account_id=$2`, [codeId, workerAccountId]);
  return result.rows[0] ?? null;
}

export class CompanyWorkforceService {
  constructor(
    private readonly database: DatabaseClient,
    private readonly pepper: string,
    private readonly now: () => Date = () => new Date()
  ) {
    if (pepper.length < 32) throw new Error("Company workforce secret pepper must contain at least 32 characters.");
  }

  async inviteWorker(principal: CompanyWorkforceManagePrincipal, input: InviteWorkerInput): Promise<CompanyWorkerInvitationSecret> {
    const email = workerEmail(input.email);
    const scopeDefaults = defaults(input);
    const now = this.now();
    const secret = createCompanyWorkerInvitationSecret(this.pepper);
    try {
      return await runVerifiedCompanyWorkforceCommand({ database: this.database, principal, now, operation: async ({ database, tenantId, membershipId }) => {
        await assertActiveUnits(database, tenantId, scopeDefaults);
        const invitationId = createIdentifier("worker_invitation");
        const expiresAt = addMs(now, INVITATION_TTL_MS);
        await database.query(
          `INSERT INTO company_worker_invitations (
             invitation_id,tenant_id,email_normalized,token_hash,invitation_status,
             site_id,department_id,payment_responsibility,assessment_reference,
             invited_by_membership_id,resend_count,resend_available_at,expires_at,created_at,updated_at
           ) VALUES ($1,$2,$3,$4,'pending',$5,$6,$7,$8,$9,0,$10,$11,$12,$12)`,
          [invitationId,tenantId,email,secret.hash,scopeDefaults.siteId,scopeDefaults.departmentId,
            scopeDefaults.paymentResponsibility,scopeDefaults.assessmentReference,membershipId,
            addMs(now,INVITATION_RESEND_COOLDOWN_MS),expiresAt,now.toISOString()]
        );
        await appendWorkforceAudit(database, principal, { action:"company_workforce.invitation.created", targetReference:invitationId, metadata:{tenantId,emailDomain:email.split("@")[1] ?? ""} });
        return Object.freeze({ invitationId, invitationToken: secret.raw, invitationPath:`/worker/company-invitations/${secret.raw}`, expiresAt });
      }});
    } catch (error) {
      if (knownCompanyError(error)) throw error;
      if (isUniqueViolation(error)) throw new CompanyWorkforceConflictError("A pending Worker invitation already exists for that email.");
      throw new CompanyWorkforceAccessError();
    }
  }

  async bulkInviteWorkers(principal: CompanyWorkforceManagePrincipal, input: readonly InviteWorkerInput[]): Promise<readonly BulkInviteWorkerResult[]> {
    if (input.length < 1 || input.length > 500) throw new CompanyWorkforceInputError("Bulk invitation must contain between 1 and 500 rows.");
    const results: BulkInviteWorkerResult[] = [];
    const seen = new Set<string>();
    for (let index=0; index<input.length; index+=1) {
      const row=input[index]!;
      let normalized:string;
      try { normalized=workerEmail(row.email); }
      catch (error) {
        results.push(Object.freeze({rowNumber:index+1,email:row.email.trim(),status:"error",invitationId:null,invitationPath:null,message:error instanceof Error?error.message:"Invalid Worker email."}));
        continue;
      }
      if (seen.has(normalized)) {
        results.push(Object.freeze({rowNumber:index+1,email:normalized,status:"error",invitationId:null,invitationPath:null,message:"Duplicate Worker email in this bulk invitation."}));
        continue;
      }
      seen.add(normalized);
      try {
        const invitation=await this.inviteWorker(principal,{...row,email:normalized});
        results.push(Object.freeze({rowNumber:index+1,email:normalized,status:"created",invitationId:invitation.invitationId,invitationPath:invitation.invitationPath,message:null}));
      } catch (error) {
        results.push(Object.freeze({rowNumber:index+1,email:normalized,status:"error",invitationId:null,invitationPath:null,message:error instanceof CompanyWorkforceInputError?error.message:"Worker invitation could not be created."}));
      }
    }
    return Object.freeze(results);
  }

  async resendInvitation(principal: CompanyWorkforceManagePrincipal, invitationId: string): Promise<CompanyWorkerInvitationSecret> {
    const id=invitationId.trim(); if(!id) throw new CompanyWorkforceInputError("Invitation reference is required.");
    const now=this.now(); const secret=createCompanyWorkerInvitationSecret(this.pepper);
    try {
      return await runVerifiedCompanyWorkforceCommand({database:this.database,principal,now,operation:async({database,tenantId})=>{
        const result=await database.query<InvitationRow>(`SELECT invitation_id,tenant_id,email_normalized,invitation_status,site_id,department_id,payment_responsibility,assessment_reference,expires_at,resend_available_at,resend_count,accepted_by_worker_account_id FROM company_worker_invitations WHERE tenant_id=$1 AND invitation_id=$2 FOR UPDATE`,[tenantId,id]);
        const row=result.rows[0]; if(!row) throw new CompanyWorkforceAccessError();
        if(row.invitation_status!=="pending") throw new CompanyWorkforceConflictError("Only a pending Worker invitation can be resent.");
        if(Date.parse(timestamp(row.expires_at))<=now.getTime()) throw new CompanyWorkforceConflictError("The Worker invitation has expired.");
        const nextAvailable=addMs(now,INVITATION_RESEND_COOLDOWN_MS);
        if(now.getTime()<Date.parse(timestamp(row.resend_available_at)) || Date.parse(nextAvailable)>=Date.parse(timestamp(row.expires_at))) throw new CompanyWorkforceConflictError("Wait before resending this Worker invitation.");
        await database.query(`UPDATE company_worker_invitations SET token_hash=$3,resend_count=resend_count+1,resend_available_at=$4,updated_at=$5 WHERE tenant_id=$1 AND invitation_id=$2`,[tenantId,id,secret.hash,nextAvailable,now.toISOString()]);
        await appendWorkforceAudit(database,principal,{action:"company_workforce.invitation.resent",targetReference:id,metadata:{tenantId,resendCount:row.resend_count+1}});
        return Object.freeze({invitationId:id,invitationToken:secret.raw,invitationPath:`/worker/company-invitations/${secret.raw}`,expiresAt:timestamp(row.expires_at)});
      }});
    } catch(error){ if(knownCompanyError(error)) throw error; throw new CompanyWorkforceAccessError(); }
  }

  async revokeInvitation(principal: CompanyWorkforceManagePrincipal, invitationId: string): Promise<void> {
    const id=invitationId.trim(); if(!id) throw new CompanyWorkforceInputError("Invitation reference is required."); const now=this.now();
    try { await runVerifiedCompanyWorkforceCommand({database:this.database,principal,now,operation:async({database,tenantId})=>{
      const result=await database.query<Pick<InvitationRow,"invitation_status">>(`SELECT invitation_status FROM company_worker_invitations WHERE tenant_id=$1 AND invitation_id=$2 FOR UPDATE`,[tenantId,id]);
      const row=result.rows[0]; if(!row) throw new CompanyWorkforceAccessError(); if(row.invitation_status==="revoked") return;
      if(row.invitation_status!=="pending") throw new CompanyWorkforceConflictError("Only a pending Worker invitation can be revoked.");
      await database.query(`UPDATE company_worker_invitations SET invitation_status='revoked',revoked_at=$3,updated_at=$3 WHERE tenant_id=$1 AND invitation_id=$2`,[tenantId,id,now.toISOString()]);
      await appendWorkforceAudit(database,principal,{action:"company_workforce.invitation.revoked",targetReference:id,metadata:{tenantId}});
    }}); } catch(error){ if(knownCompanyError(error)) throw error; throw new CompanyWorkforceAccessError(); }
  }

  async createRegistrationCode(principal: CompanyWorkforceManagePrincipal,input:CreateCompanyRegistrationCodeInput):Promise<CompanyRegistrationCodeSecret>{
    if(!Number.isSafeInteger(input.usageLimit)||input.usageLimit<1||input.usageLimit>10000) throw new CompanyWorkforceInputError("Usage limit must be between 1 and 10,000.");
    const scopeDefaults=defaults(input); const now=this.now(); const expiryMs=Date.parse(input.expiresAt);
    if(!Number.isFinite(expiryMs)||expiryMs<=now.getTime()||expiryMs-now.getTime()>MAX_CODE_TTL_MS) throw new CompanyWorkforceInputError("Company code expiry must be within the next 90 days.");
    const secret=createCompanyRegistrationCodeSecret(this.pepper);
    try{return await runVerifiedCompanyWorkforceCommand({database:this.database,principal,now,operation:async({database,tenantId,membershipId})=>{
      await assertActiveUnits(database,tenantId,scopeDefaults); const codeId=createIdentifier("company_code"); const expiresAt=new Date(expiryMs).toISOString();
      await database.query(`INSERT INTO company_registration_codes
        (code_id,tenant_id,code_hash,code_status,usage_limit,usage_count,site_id,department_id,payment_responsibility,assessment_reference,created_by_membership_id,expires_at,created_at,updated_at)
        VALUES ($1,$2,$3,'active',$4,0,$5,$6,$7,$8,$9,$10,$11,$11)`,[codeId,tenantId,secret.hash,input.usageLimit,scopeDefaults.siteId,scopeDefaults.departmentId,scopeDefaults.paymentResponsibility,scopeDefaults.assessmentReference,membershipId,expiresAt,now.toISOString()]);
      await appendWorkforceAudit(database,principal,{action:"company_workforce.code.created",targetReference:codeId,metadata:{tenantId,usageLimit:input.usageLimit}});
      return Object.freeze({codeId,registrationCode:secret.raw,expiresAt,usageLimit:input.usageLimit});
    }});}catch(error){if(knownCompanyError(error))throw error;if(isUniqueViolation(error))throw new CompanyWorkforceConflictError();throw new CompanyWorkforceAccessError();}
  }

  async revokeRegistrationCode(principal:CompanyWorkforceManagePrincipal,codeId:string):Promise<void>{
    const id=codeId.trim();if(!id)throw new CompanyWorkforceInputError("Company code reference is required.");const now=this.now();
    try{await runVerifiedCompanyWorkforceCommand({database:this.database,principal,now,operation:async({database,tenantId})=>{
      const result=await database.query<Pick<CodeRow,"code_status">>(`SELECT code_status FROM company_registration_codes WHERE tenant_id=$1 AND code_id=$2 FOR UPDATE`,[tenantId,id]);const row=result.rows[0];if(!row)throw new CompanyWorkforceAccessError();if(row.code_status==="revoked")return;if(row.code_status!=="active")throw new CompanyWorkforceConflictError("Only an active Company code can be revoked.");
      await database.query(`UPDATE company_registration_codes SET code_status='revoked',revoked_at=$3,updated_at=$3 WHERE tenant_id=$1 AND code_id=$2`,[tenantId,id,now.toISOString()]);
      await appendWorkforceAudit(database,principal,{action:"company_workforce.code.revoked",targetReference:id,metadata:{tenantId}});
    }});}catch(error){if(knownCompanyError(error))throw error;throw new CompanyWorkforceAccessError();}
  }

  async acceptInvitation(principal:AuthorizationPrincipal,token:string):Promise<CompanyWorkerLinkRecord>{
    const raw=token.trim();if(raw.length<24)throw new CompanyWorkforceSecretError();const now=this.now();const hash=hashOpaqueValue(raw,this.pepper,INVITATION_SECRET_CONTEXT);
    try{return await runWorkerCommand({database:this.database,principal,now,operation:async({database,workerAccountId,email})=>{
      const result=await database.query<InvitationRow>(`SELECT invitation_id,tenant_id,email_normalized,invitation_status,site_id,department_id,payment_responsibility,assessment_reference,expires_at,resend_available_at,resend_count,accepted_by_worker_account_id FROM company_worker_invitations WHERE token_hash=$1 FOR UPDATE`,[hash]);const invitation=result.rows[0];if(!invitation)throw new CompanyWorkforceSecretError();
      const existing=await findLinkByInvitation(database,invitation.invitation_id,workerAccountId);if(invitation.invitation_status==="accepted"&&existing)return linkRecord(existing);
      if(invitation.invitation_status!=="pending"||Date.parse(timestamp(invitation.expires_at))<=now.getTime()||invitation.email_normalized!==email)throw new CompanyWorkforceSecretError();
      await assertVerifiedCompany(database,invitation.tenant_id); const live=await liveLink(database,invitation.tenant_id,workerAccountId);if(live)throw new CompanyWorkforceConflictError("Worker is already linked to this Company.");
      const linkId=createIdentifier("company_worker_link"),nowIso=now.toISOString();
      const inserted=await database.query<LinkRow>(`INSERT INTO company_worker_links
        (link_id,tenant_id,worker_account_id,permanent_worker_id,link_source,invitation_id,code_id,link_status,site_id,department_id,payment_responsibility,assessment_reference,requested_by_membership_id,worker_accepted_at,activated_at,created_at,updated_at)
        SELECT $1,$2,$3,NULL,'invitation',$4,NULL,'active',$5,$6,$7,$8,invited_by_membership_id,$9,$9,$9,$9 FROM company_worker_invitations WHERE invitation_id=$4
        RETURNING link_id,tenant_id,worker_account_id,permanent_worker_id,link_source,link_status,site_id,department_id,payment_responsibility,assessment_reference,worker_accepted_at,activated_at,revoked_at`,[linkId,invitation.tenant_id,workerAccountId,invitation.invitation_id,invitation.site_id,invitation.department_id,invitation.payment_responsibility,invitation.assessment_reference,nowIso]);
      await database.query(`UPDATE company_worker_invitations SET invitation_status='accepted',accepted_by_worker_account_id=$2,accepted_at=$3,updated_at=$3 WHERE invitation_id=$1 AND invitation_status='pending'`,[invitation.invitation_id,workerAccountId,nowIso]);
      await appendWorkforceAudit(database,principal,{action:"company_workforce.invitation.accepted",targetReference:invitation.invitation_id,metadata:{tenantId:invitation.tenant_id,linkId}});
      const row=inserted.rows[0];if(!row)throw new CompanyWorkforceConflictError();return linkRecord(row);
    }});}catch(error){if(error instanceof CompanyWorkforceAccessError||error instanceof CompanyWorkforceSecretError||error instanceof CompanyWorkforceConflictError)throw error;throw new CompanyWorkforceSecretError();}
  }

  async redeemRegistrationCode(principal:AuthorizationPrincipal,code:string):Promise<CompanyWorkerLinkRecord>{
    const raw=code.trim();if(raw.length<24)throw new CompanyWorkforceSecretError();const now=this.now();const hash=hashOpaqueValue(raw,this.pepper,REGISTRATION_CODE_SECRET_CONTEXT);
    try{return await runWorkerCommand({database:this.database,principal,now,operation:async({database,workerAccountId})=>{
      const result=await database.query<CodeRow>(`SELECT code_id,tenant_id,code_status,usage_limit,usage_count,site_id,department_id,payment_responsibility,assessment_reference,expires_at FROM company_registration_codes WHERE code_hash=$1 FOR UPDATE`,[hash]);const row=result.rows[0];if(!row)throw new CompanyWorkforceSecretError();
      const same=await findLinkByCode(database,row.code_id,workerAccountId);if(same)return linkRecord(same);
      if(row.code_status!=="active"||Date.parse(timestamp(row.expires_at))<=now.getTime())throw new CompanyWorkforceSecretError();await assertVerifiedCompany(database,row.tenant_id);
      const existing=await liveLink(database,row.tenant_id,workerAccountId);if(existing)throw new CompanyWorkforceConflictError("Worker is already linked to this Company.");
      const next=row.usage_count+1;if(next>row.usage_limit)throw new CompanyWorkforceSecretError();const nowIso=now.toISOString();
      await database.query(`UPDATE company_registration_codes SET usage_count=$2,code_status=CASE WHEN $2=usage_limit THEN 'exhausted' ELSE 'active' END,exhausted_at=CASE WHEN $2=usage_limit THEN $3::timestamptz ELSE NULL END,updated_at=$3 WHERE code_id=$1`,[row.code_id,next,nowIso]);
      const linkId=createIdentifier("company_worker_link");const inserted=await database.query<LinkRow>(`INSERT INTO company_worker_links
        (link_id,tenant_id,worker_account_id,permanent_worker_id,link_source,invitation_id,code_id,link_status,site_id,department_id,payment_responsibility,assessment_reference,requested_by_membership_id,worker_accepted_at,activated_at,created_at,updated_at)
        SELECT $1,$2,$3,NULL,'code',NULL,$4,'active',$5,$6,$7,$8,created_by_membership_id,$9,$9,$9,$9 FROM company_registration_codes WHERE code_id=$4
        RETURNING link_id,tenant_id,worker_account_id,permanent_worker_id,link_source,link_status,site_id,department_id,payment_responsibility,assessment_reference,worker_accepted_at,activated_at,revoked_at`,[linkId,row.tenant_id,workerAccountId,row.code_id,row.site_id,row.department_id,row.payment_responsibility,row.assessment_reference,nowIso]);
      await appendWorkforceAudit(database,principal,{action:"company_workforce.code.redeemed",targetReference:row.code_id,metadata:{tenantId:row.tenant_id,linkId,usageCount:next}});const linked=inserted.rows[0];if(!linked)throw new CompanyWorkforceConflictError();return linkRecord(linked);
    }});}catch(error){if(error instanceof CompanyWorkforceAccessError||error instanceof CompanyWorkforceSecretError||error instanceof CompanyWorkforceConflictError)throw error;if(isUniqueViolation(error))throw new CompanyWorkforceSecretError();throw new CompanyWorkforceSecretError();}
  }

  async requestPermanentWorkerLink(principal:CompanyWorkforceManagePrincipal,permanentWorkerId:string,input:InviteWorkerInput):Promise<CompanyWorkerLinkRecord>{
    const id=permanentWorkerId.trim();if(!id)throw new CompanyWorkforceInputError("Permanent Worker-ID is required.");const email=workerEmail(input.email);const scopeDefaults=defaults(input);const now=this.now();
    try{return await runVerifiedCompanyWorkforceCommand({database:this.database,principal,now,operation:async({database,tenantId,membershipId})=>{
      await assertActiveUnits(database,tenantId,scopeDefaults);const worker=await database.query<{worker_account_id:string;email_normalized:string}>(`SELECT ids.worker_account_id,accounts.email_normalized FROM worker_identity_worker_ids AS ids JOIN auth_accounts AS accounts ON accounts.account_id=ids.worker_account_id JOIN auth_account_roles AS roles ON roles.account_id=accounts.account_id AND roles.role='worker' WHERE ids.permanent_worker_id=$1 AND accounts.account_status='active' FOR UPDATE OF ids,accounts`,[id]);const found=worker.rows[0];if(!found||found.email_normalized!==email)throw new CompanyWorkforceAccessError();
      const existing=await liveLink(database,tenantId,found.worker_account_id);if(existing)return linkRecord(existing);const linkId=createIdentifier("company_worker_link"),nowIso=now.toISOString();
      const inserted=await database.query<LinkRow>(`INSERT INTO company_worker_links
        (link_id,tenant_id,worker_account_id,permanent_worker_id,link_source,invitation_id,code_id,link_status,site_id,department_id,payment_responsibility,assessment_reference,requested_by_membership_id,created_at,updated_at)
        VALUES ($1,$2,$3,$4,'permanent_worker_id',NULL,NULL,'pending_worker_acceptance',$5,$6,$7,$8,$9,$10,$10)
        RETURNING link_id,tenant_id,worker_account_id,permanent_worker_id,link_source,link_status,site_id,department_id,payment_responsibility,assessment_reference,worker_accepted_at,activated_at,revoked_at`,[linkId,tenantId,found.worker_account_id,id,scopeDefaults.siteId,scopeDefaults.departmentId,scopeDefaults.paymentResponsibility,scopeDefaults.assessmentReference,membershipId,nowIso]);
      await appendWorkforceAudit(database,principal,{action:"company_workforce.link.requested",targetReference:linkId,metadata:{tenantId,permanentWorkerId:id}});const row=inserted.rows[0];if(!row)throw new CompanyWorkforceConflictError();return linkRecord(row);
    }});}catch(error){if(knownCompanyError(error))throw error;if(isUniqueViolation(error))throw new CompanyWorkforceConflictError();throw new CompanyWorkforceAccessError();}
  }

  async acceptWorkerLink(principal:AuthorizationPrincipal,linkId:string):Promise<CompanyWorkerLinkRecord>{
    const id=linkId.trim();if(!id)throw new CompanyWorkforceAccessError();const now=this.now();
    try{return await runWorkerCommand({database:this.database,principal,now,operation:async({database,workerAccountId})=>{
      const result=await database.query<LinkRow>(`SELECT link_id,tenant_id,worker_account_id,permanent_worker_id,link_source,link_status,site_id,department_id,payment_responsibility,assessment_reference,worker_accepted_at,activated_at,revoked_at FROM company_worker_links WHERE link_id=$1 FOR UPDATE`,[id]);const row=result.rows[0];if(!row||row.worker_account_id!==workerAccountId)throw new CompanyWorkforceAccessError();if(row.link_status==="active")return linkRecord(row);if(row.link_status!=="pending_worker_acceptance")throw new CompanyWorkforceAccessError();await assertVerifiedCompany(database,row.tenant_id);const nowIso=now.toISOString();
      const updated=await database.query<LinkRow>(`UPDATE company_worker_links SET link_status='active',worker_accepted_at=$2,activated_at=$2,updated_at=$2 WHERE link_id=$1 AND link_status='pending_worker_acceptance' RETURNING link_id,tenant_id,worker_account_id,permanent_worker_id,link_source,link_status,site_id,department_id,payment_responsibility,assessment_reference,worker_accepted_at,activated_at,revoked_at`,[id,nowIso]);await appendWorkforceAudit(database,principal,{action:"company_workforce.link.accepted",targetReference:id,metadata:{tenantId:row.tenant_id}});const active=updated.rows[0];if(!active)throw new CompanyWorkforceConflictError();return linkRecord(active);
    }});}catch(error){if(error instanceof CompanyWorkforceAccessError||error instanceof CompanyWorkforceConflictError)throw error;throw new CompanyWorkforceAccessError();}
  }
}
