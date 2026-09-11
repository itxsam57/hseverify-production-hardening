import "server-only";

import type { AuthorizationPrincipal } from "../authorization/authorization-context-domain";
import { getDatabaseClient, type DatabaseClient } from "../database/database";
import { CompanyWorkforceAccessError } from "./company-workforce-domain";

export type WorkerCompanyAccessLink = Readonly<{
  linkId: string;
  tenantId: string;
  companyName: string;
  permanentWorkerId: string | null;
  source: "invitation" | "code" | "permanent_worker_id";
  status: "pending_worker_acceptance" | "active" | "revoked";
  siteName: string | null;
  departmentName: string | null;
  paymentResponsibility: "company" | "worker";
  assessmentReference: string | null;
  createdAt: string;
  activatedAt: string | null;
  revokedAt: string | null;
}>;

type LinkRow = {
  link_id: string;
  tenant_id: string;
  company_name: string;
  permanent_worker_id: string | null;
  link_source: WorkerCompanyAccessLink["source"];
  link_status: WorkerCompanyAccessLink["status"];
  site_name: string | null;
  department_name: string | null;
  payment_responsibility: WorkerCompanyAccessLink["paymentResponsibility"];
  assessment_reference: string | null;
  created_at: string | Date;
  activated_at: string | Date | null;
  revoked_at: string | Date | null;
};

function timestamp(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function nullableTimestamp(value: string | Date | null): string | null {
  return value === null ? null : timestamp(value);
}

function fromRow(row: LinkRow): WorkerCompanyAccessLink {
  return Object.freeze({
    linkId: row.link_id,
    tenantId: row.tenant_id,
    companyName: row.company_name,
    permanentWorkerId: row.permanent_worker_id,
    source: row.link_source,
    status: row.link_status,
    siteName: row.site_name,
    departmentName: row.department_name,
    paymentResponsibility: row.payment_responsibility,
    assessmentReference: row.assessment_reference,
    createdAt: timestamp(row.created_at),
    activatedAt: nullableTimestamp(row.activated_at),
    revokedAt: nullableTimestamp(row.revoked_at)
  });
}

async function assertLiveWorker(
  database: DatabaseClient,
  principal: AuthorizationPrincipal,
  now: Date
): Promise<string> {
  if (
    principal.activeRole !== "worker" ||
    principal.accountStatus !== "active" ||
    principal.tenantMembership !== null
  ) {
    throw new CompanyWorkforceAccessError();
  }
  const result = await database.query<{ account_id: string }>(
    `SELECT accounts.account_id
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
  if (result.rows[0]?.account_id !== principal.accountId) {
    throw new CompanyWorkforceAccessError();
  }
  return principal.accountId;
}

export class CompanyWorkforceWorkerReadRepository {
  constructor(
    private readonly clientPromise: Promise<DatabaseClient> = getDatabaseClient(),
    private readonly now: () => Date = () => new Date()
  ) {}

  async listLinks(principal: AuthorizationPrincipal): Promise<readonly WorkerCompanyAccessLink[]> {
    const database = await this.clientPromise;
    const now = this.now();
    return database.transaction(async (transaction) => {
      const workerAccountId = await assertLiveWorker(transaction, principal, now);
      const result = await transaction.query<LinkRow>(
        `SELECT links.link_id,
                links.tenant_id,
                tenants.display_name AS company_name,
                links.permanent_worker_id,
                links.link_source,
                links.link_status,
                sites.name AS site_name,
                departments.name AS department_name,
                links.payment_responsibility,
                links.assessment_reference,
                links.created_at,
                links.activated_at,
                links.revoked_at
         FROM company_worker_links AS links
         JOIN platform_tenants AS tenants
           ON tenants.tenant_id=links.tenant_id
          AND tenants.tenant_type='company'
         LEFT JOIN company_sites AS sites
           ON sites.tenant_id=links.tenant_id
          AND sites.site_id=links.site_id
         LEFT JOIN company_departments AS departments
           ON departments.tenant_id=links.tenant_id
          AND departments.department_id=links.department_id
         WHERE links.worker_account_id=$1
         ORDER BY
           CASE links.link_status
             WHEN 'pending_worker_acceptance' THEN 0
             WHEN 'active' THEN 1
             ELSE 2
           END,
           links.created_at DESC
         LIMIT 100`,
        [workerAccountId]
      );
      return Object.freeze(result.rows.map(fromRow));
    });
  }
}

let repository: CompanyWorkforceWorkerReadRepository | null = null;
export function getCompanyWorkforceWorkerReadRepository(): CompanyWorkforceWorkerReadRepository {
  repository ??= new CompanyWorkforceWorkerReadRepository();
  return repository;
}
