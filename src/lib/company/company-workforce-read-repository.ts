import "server-only";

import { getDatabaseClient, type DatabaseClient } from "../database/database";
import type { CompanyWorkforceManagePrincipal } from "./company-workforce-domain";
import { runVerifiedCompanyWorkforceCommand } from "./company-workforce-service";
import type {
  CompanyRegistrationCodeView,
  CompanyWorkerInvitationView,
  CompanyWorkerLinkView,
  CompanyWorkforceOverview
} from "./company-workforce-view-model";

type InvitationRow = {
  invitation_id: string;
  email_normalized: string;
  invitation_status: CompanyWorkerInvitationView["status"];
  site_id: string | null;
  site_name: string | null;
  department_id: string | null;
  department_name: string | null;
  payment_responsibility: CompanyWorkerInvitationView["paymentResponsibility"];
  assessment_reference: string | null;
  resend_count: number;
  resend_available_at: string | Date;
  expires_at: string | Date;
  created_at: string | Date;
};

type CodeRow = {
  code_id: string;
  code_status: CompanyRegistrationCodeView["status"];
  usage_limit: number;
  usage_count: number;
  site_id: string | null;
  site_name: string | null;
  department_id: string | null;
  department_name: string | null;
  payment_responsibility: CompanyRegistrationCodeView["paymentResponsibility"];
  assessment_reference: string | null;
  expires_at: string | Date;
  created_at: string | Date;
};

type LinkRow = {
  link_id: string;
  worker_account_id: string;
  worker_email: string;
  permanent_worker_id: string | null;
  link_source: CompanyWorkerLinkView["source"];
  link_status: CompanyWorkerLinkView["status"];
  site_id: string | null;
  site_name: string | null;
  department_id: string | null;
  department_name: string | null;
  payment_responsibility: CompanyWorkerLinkView["paymentResponsibility"];
  assessment_reference: string | null;
  worker_accepted_at: string | Date | null;
  activated_at: string | Date | null;
  created_at: string | Date;
};

function timestamp(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function nullableTimestamp(value: string | Date | null): string | null {
  return value === null ? null : timestamp(value);
}

function invitation(row: InvitationRow): CompanyWorkerInvitationView {
  return Object.freeze({
    invitationId: row.invitation_id,
    email: row.email_normalized,
    status: row.invitation_status,
    siteId: row.site_id,
    siteName: row.site_name,
    departmentId: row.department_id,
    departmentName: row.department_name,
    paymentResponsibility: row.payment_responsibility,
    assessmentReference: row.assessment_reference,
    resendCount: Number(row.resend_count),
    resendAvailableAt: timestamp(row.resend_available_at),
    expiresAt: timestamp(row.expires_at),
    createdAt: timestamp(row.created_at)
  });
}

function code(row: CodeRow): CompanyRegistrationCodeView {
  return Object.freeze({
    codeId: row.code_id,
    status: row.code_status,
    usageLimit: Number(row.usage_limit),
    usageCount: Number(row.usage_count),
    siteId: row.site_id,
    siteName: row.site_name,
    departmentId: row.department_id,
    departmentName: row.department_name,
    paymentResponsibility: row.payment_responsibility,
    assessmentReference: row.assessment_reference,
    expiresAt: timestamp(row.expires_at),
    createdAt: timestamp(row.created_at)
  });
}

function link(row: LinkRow): CompanyWorkerLinkView {
  return Object.freeze({
    linkId: row.link_id,
    workerAccountId: row.worker_account_id,
    workerEmail: row.worker_email,
    permanentWorkerId: row.permanent_worker_id,
    source: row.link_source,
    status: row.link_status,
    siteId: row.site_id,
    siteName: row.site_name,
    departmentId: row.department_id,
    departmentName: row.department_name,
    paymentResponsibility: row.payment_responsibility,
    assessmentReference: row.assessment_reference,
    workerAcceptedAt: nullableTimestamp(row.worker_accepted_at),
    activatedAt: nullableTimestamp(row.activated_at),
    createdAt: timestamp(row.created_at)
  });
}

export class CompanyWorkforceReadRepository {
  constructor(
    private readonly clientPromise: Promise<DatabaseClient> = getDatabaseClient()
  ) {}

  async readOverview(
    principal: CompanyWorkforceManagePrincipal
  ): Promise<CompanyWorkforceOverview> {
    return runVerifiedCompanyWorkforceCommand({
      database: await this.clientPromise,
      principal,
      operation: async ({ database, tenantId }) => {
        const [invitations, codes, links] = await Promise.all([
          database.query<InvitationRow>(
            `SELECT invitations.invitation_id,
                    invitations.email_normalized,
                    invitations.invitation_status,
                    invitations.site_id,
                    sites.name AS site_name,
                    invitations.department_id,
                    departments.name AS department_name,
                    invitations.payment_responsibility,
                    invitations.assessment_reference,
                    invitations.resend_count,
                    invitations.resend_available_at,
                    invitations.expires_at,
                    invitations.created_at
             FROM company_worker_invitations AS invitations
             LEFT JOIN company_sites AS sites
               ON sites.tenant_id=invitations.tenant_id
              AND sites.site_id=invitations.site_id
             LEFT JOIN company_departments AS departments
               ON departments.tenant_id=invitations.tenant_id
              AND departments.department_id=invitations.department_id
             WHERE invitations.tenant_id=$1
             ORDER BY invitations.created_at DESC
             LIMIT 100`,
            [tenantId]
          ),
          database.query<CodeRow>(
            `SELECT codes.code_id,
                    codes.code_status,
                    codes.usage_limit,
                    codes.usage_count,
                    codes.site_id,
                    sites.name AS site_name,
                    codes.department_id,
                    departments.name AS department_name,
                    codes.payment_responsibility,
                    codes.assessment_reference,
                    codes.expires_at,
                    codes.created_at
             FROM company_registration_codes AS codes
             LEFT JOIN company_sites AS sites
               ON sites.tenant_id=codes.tenant_id
              AND sites.site_id=codes.site_id
             LEFT JOIN company_departments AS departments
               ON departments.tenant_id=codes.tenant_id
              AND departments.department_id=codes.department_id
             WHERE codes.tenant_id=$1
             ORDER BY codes.created_at DESC
             LIMIT 100`,
            [tenantId]
          ),
          database.query<LinkRow>(
            `SELECT links.link_id,
                    links.worker_account_id,
                    workers.email_normalized AS worker_email,
                    links.permanent_worker_id,
                    links.link_source,
                    links.link_status,
                    links.site_id,
                    sites.name AS site_name,
                    links.department_id,
                    departments.name AS department_name,
                    links.payment_responsibility,
                    links.assessment_reference,
                    links.worker_accepted_at,
                    links.activated_at,
                    links.created_at
             FROM company_worker_links AS links
             JOIN auth_accounts AS workers
               ON workers.account_id=links.worker_account_id
             LEFT JOIN company_sites AS sites
               ON sites.tenant_id=links.tenant_id
              AND sites.site_id=links.site_id
             LEFT JOIN company_departments AS departments
               ON departments.tenant_id=links.tenant_id
              AND departments.department_id=links.department_id
             WHERE links.tenant_id=$1
             ORDER BY links.created_at DESC
             LIMIT 100`,
            [tenantId]
          )
        ]);

        return Object.freeze({
          invitations: Object.freeze(invitations.rows.map(invitation)),
          codes: Object.freeze(codes.rows.map(code)),
          links: Object.freeze(links.rows.map(link))
        });
      }
    });
  }
}

let repository: CompanyWorkforceReadRepository | null = null;
export function getCompanyWorkforceReadRepository(): CompanyWorkforceReadRepository {
  repository ??= new CompanyWorkforceReadRepository();
  return repository;
}
