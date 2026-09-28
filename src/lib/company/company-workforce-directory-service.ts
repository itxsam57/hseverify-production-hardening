import "server-only";

import { getDatabaseClient, type DatabaseClient } from "@/lib/database/database";
import type { CompanyWorkforceManagePrincipal } from "@/lib/company/company-workforce-domain";
import { runVerifiedCompanyWorkforceCommand } from "@/lib/company/company-workforce-service";

export type CompanyWorkerDirectoryRow = Readonly<{
  linkId: string;
  workerAccountId: string;
  name: string;
  email: string;
  workerId: string | null;
  status: string;
  site: string | null;
  department: string | null;
  assessmentReference: string | null;
  assuranceStatus: string | null;
  nextAction: string | null;
}>;

export type CompanyWorkerDirectoryResult = Readonly<{
  rows: readonly CompanyWorkerDirectoryRow[];
  total: number;
  page: number;
  pageSize: number;
}>;

export type CompanyWorkerDirectorySearch = Readonly<{
  query?: string | null;
  status?: string | null;
  siteId?: string | null;
  departmentId?: string | null;
  assuranceStatus?: string | null;
  page?: number;
  pageSize?: number;
}>;

function boundedText(value: string | null | undefined, max = 120): string {
  return (value ?? "").trim().slice(0, max);
}
function boundedPage(value: number | undefined): number {
  return Number.isSafeInteger(value) && (value ?? 0) > 0 ? Number(value) : 1;
}
function boundedPageSize(value: number | undefined): number {
  const parsed = Number.isSafeInteger(value) ? Number(value) : 25;
  return Math.max(10, Math.min(100, parsed));
}

export class CompanyWorkforceDirectoryService {
  constructor(private readonly databasePromise: Promise<DatabaseClient> = getDatabaseClient()) {}

  async search(
    principal: CompanyWorkforceManagePrincipal,
    input: CompanyWorkerDirectorySearch = {}
  ): Promise<CompanyWorkerDirectoryResult> {
    const database = await this.databasePromise;
    return runVerifiedCompanyWorkforceCommand({
      database,
      principal,
      operation: async ({ database: scoped, tenantId }) => {
        const query = boundedText(input.query, 160);
        const status = boundedText(input.status, 40);
        const siteId = boundedText(input.siteId, 160);
        const departmentId = boundedText(input.departmentId, 160);
        const assuranceStatus = boundedText(input.assuranceStatus, 80);
        const page = boundedPage(input.page);
        const pageSize = boundedPageSize(input.pageSize);
        const offset = (page - 1) * pageSize;

        const parameters = [
          tenantId,
          query || null,
          status || null,
          siteId || null,
          departmentId || null,
          assuranceStatus || null
        ];
        const where = `
          links.tenant_id=$1
          AND ($2::text IS NULL OR
               accounts.display_name ILIKE '%' || $2 || '%' OR
               accounts.email_normalized ILIKE '%' || $2 || '%' OR
               links.permanent_worker_id ILIKE '%' || $2 || '%')
          AND ($3::text IS NULL OR links.link_status=$3)
          AND ($4::text IS NULL OR links.site_id=$4)
          AND ($5::text IS NULL OR links.department_id=$5)
          AND ($6::text IS NULL OR latest_case.case_status=$6)
        `;

        const [rows, count] = await Promise.all([
          scoped.query<{
            link_id: string;
            worker_account_id: string;
            display_name: string;
            email_normalized: string;
            permanent_worker_id: string | null;
            link_status: string;
            site_name: string | null;
            department_name: string | null;
            assessment_reference: string | null;
            case_status: string | null;
            next_action: string | null;
          }>(
            `SELECT links.link_id,links.worker_account_id,accounts.display_name,accounts.email_normalized,
                    links.permanent_worker_id,links.link_status,
                    sites.name AS site_name,departments.name AS department_name,
                    links.assessment_reference,latest_case.case_status,latest_case.next_action
               FROM company_worker_links AS links
               JOIN auth_accounts AS accounts ON accounts.account_id=links.worker_account_id
               LEFT JOIN company_sites AS sites ON sites.tenant_id=links.tenant_id AND sites.site_id=links.site_id
               LEFT JOIN company_departments AS departments ON departments.tenant_id=links.tenant_id AND departments.department_id=links.department_id
               LEFT JOIN LATERAL (
                 SELECT cases.case_status,cases.next_action
                   FROM assurance_cases AS cases
                  WHERE cases.tenant_id=links.tenant_id
                    AND cases.worker_account_id=links.worker_account_id
                  ORDER BY cases.updated_at DESC,cases.created_at DESC
                  LIMIT 1
               ) AS latest_case ON TRUE
              WHERE ${where}
              ORDER BY accounts.display_name,accounts.email_normalized,links.link_id
              LIMIT $7 OFFSET $8`,
            [...parameters, pageSize, offset]
          ),
          scoped.query<{ count: number | string }>(
            `SELECT count(*) AS count
               FROM company_worker_links AS links
               JOIN auth_accounts AS accounts ON accounts.account_id=links.worker_account_id
               LEFT JOIN LATERAL (
                 SELECT cases.case_status
                   FROM assurance_cases AS cases
                  WHERE cases.tenant_id=links.tenant_id
                    AND cases.worker_account_id=links.worker_account_id
                  ORDER BY cases.updated_at DESC,cases.created_at DESC
                  LIMIT 1
               ) AS latest_case ON TRUE
              WHERE ${where}`,
            parameters
          )
        ]);

        return Object.freeze({
          rows: Object.freeze(rows.rows.map((row) => Object.freeze({
            linkId: row.link_id,
            workerAccountId: row.worker_account_id,
            name: row.display_name,
            email: row.email_normalized,
            workerId: row.permanent_worker_id,
            status: row.link_status,
            site: row.site_name,
            department: row.department_name,
            assessmentReference: row.assessment_reference,
            assuranceStatus: row.case_status,
            nextAction: row.next_action
          }))),
          total: Number(count.rows[0]?.count ?? 0),
          page,
          pageSize
        });
      }
    });
  }

  async find(
    principal: CompanyWorkforceManagePrincipal,
    linkId: string
  ): Promise<CompanyWorkerDirectoryRow | null> {
    const database = await this.databasePromise;
    return runVerifiedCompanyWorkforceCommand({
      database,
      principal,
      operation: async ({ database: scoped, tenantId }) => {
        const result = await scoped.query<{
          link_id: string; worker_account_id: string; display_name: string; email_normalized: string;
          permanent_worker_id: string | null; link_status: string; site_name: string | null;
          department_name: string | null; assessment_reference: string | null;
          case_status: string | null; next_action: string | null;
        }>(
          `SELECT links.link_id,links.worker_account_id,accounts.display_name,accounts.email_normalized,
                  links.permanent_worker_id,links.link_status,sites.name AS site_name,
                  departments.name AS department_name,links.assessment_reference,
                  latest_case.case_status,latest_case.next_action
             FROM company_worker_links AS links
             JOIN auth_accounts AS accounts ON accounts.account_id=links.worker_account_id
             LEFT JOIN company_sites AS sites ON sites.tenant_id=links.tenant_id AND sites.site_id=links.site_id
             LEFT JOIN company_departments AS departments ON departments.tenant_id=links.tenant_id AND departments.department_id=links.department_id
             LEFT JOIN LATERAL (
               SELECT cases.case_status,cases.next_action
                 FROM assurance_cases AS cases
                WHERE cases.tenant_id=links.tenant_id AND cases.worker_account_id=links.worker_account_id
                ORDER BY cases.updated_at DESC,cases.created_at DESC LIMIT 1
             ) AS latest_case ON TRUE
            WHERE links.tenant_id=$1 AND links.link_id=$2`,
          [tenantId, linkId]
        );
        const row = result.rows[0];
        return row ? Object.freeze({
          linkId: row.link_id,
          workerAccountId: row.worker_account_id,
          name: row.display_name,
          email: row.email_normalized,
          workerId: row.permanent_worker_id,
          status: row.link_status,
          site: row.site_name,
          department: row.department_name,
          assessmentReference: row.assessment_reference,
          assuranceStatus: row.case_status,
          nextAction: row.next_action
        }) : null;
      }
    });
  }
}

let service: CompanyWorkforceDirectoryService | null = null;
export function getCompanyWorkforceDirectoryService(): CompanyWorkforceDirectoryService {
  service ??= new CompanyWorkforceDirectoryService();
  return service;
}
