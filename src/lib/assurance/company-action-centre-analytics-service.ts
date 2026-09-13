import "server-only";

import { deriveTrustedTenantScope } from "../authorization/tenant-scoped-resource-domain";
import type { DatabaseClient } from "../database/database";
import {
  ASSURANCE_ORDER_READ_PERMISSION,
  AssuranceOrderAccessError,
  type AssuranceOrderReadPrincipal,
  type AssurancePendingOwner
} from "./assurance-order-domain";

type SummaryRow = {
  total_orders: number | string;
  active_orders: number | string;
  active_cases: number | string;
  company_approvals_required: number | string;
  overdue_actions: number | string;
};

type CountRow = { label: string; count: number | string };
type ReadinessRow = {
  scope_id: string;
  scope_name: string | null;
  total: number | string;
  assured: number | string;
  conditional: number | string;
  attention: number | string;
  in_progress: number | string;
};
type GapRow = {
  credential_target: string;
  total: number | string;
  assured: number | string;
};

export type CompanyActionCentreSummary = Readonly<{
  totalOrders: number;
  activeOrders: number;
  activeCases: number;
  companyApprovalsRequired: number;
  overdueActions: number;
}>;

export type CompanyReadinessSlice = Readonly<{
  scopeId: string;
  scopeName: string;
  total: number;
  assured: number;
  conditional: number;
  attention: number;
  inProgress: number;
  readinessPercent: number;
}>;

export type CompanyCompetencyGap = Readonly<{
  credentialTarget: string;
  total: number;
  assured: number;
  gap: number;
  gapPercent: number;
}>;

export type CompanyActionCentreAnalytics = Readonly<{
  summary: CompanyActionCentreSummary;
  workflowStages: readonly Readonly<{ status: string; count: number }>[];
  pendingOwners: readonly Readonly<{ owner: AssurancePendingOwner; count: number }>[];
  siteReadiness: readonly CompanyReadinessSlice[];
  departmentReadiness: readonly CompanyReadinessSlice[];
  competencyGaps: readonly CompanyCompetencyGap[];
}>;

function number(value: number | string): number {
  return Number(value);
}

function percent(part: number, total: number): number {
  return total === 0 ? 0 : Math.round((part / total) * 100);
}

function readiness(row: ReadinessRow): CompanyReadinessSlice {
  const total = number(row.total);
  const assured = number(row.assured);
  return Object.freeze({
    scopeId: row.scope_id,
    scopeName: row.scope_name ?? row.scope_id,
    total,
    assured,
    conditional: number(row.conditional),
    attention: number(row.attention),
    inProgress: number(row.in_progress),
    readinessPercent: percent(assured, total)
  });
}

const READINESS_CASE_FILTER = `
  cases.tenant_id=$1
  AND orders.tenant_id=$1
  AND targets.tenant_id=$1
  AND orders.order_status <> 'CANCELLED'
  AND cases.case_status <> 'Closed'`;

export class CompanyActionCentreAnalyticsService {
  constructor(private readonly database: DatabaseClient) {}

  async snapshot(
    principal: AssuranceOrderReadPrincipal,
    now = new Date()
  ): Promise<CompanyActionCentreAnalytics> {
    if (principal.authorizedTenantPermission !== ASSURANCE_ORDER_READ_PERMISSION) {
      throw new AssuranceOrderAccessError();
    }
    const tenantId = deriveTrustedTenantScope(principal).tenantId;
    const nowIso = now.toISOString();

    const [summaryResult, stageResult, ownerResult, siteResult, departmentResult, gapResult] =
      await Promise.all([
        this.database.query<SummaryRow>(
          `SELECT
             (SELECT COUNT(*) FROM assurance_orders WHERE tenant_id=$1)::int AS total_orders,
             (SELECT COUNT(*) FROM assurance_orders WHERE tenant_id=$1 AND order_status NOT IN ('COMPLETED','CANCELLED','CLOSED'))::int AS active_orders,
             (SELECT COUNT(*) FROM assurance_cases WHERE tenant_id=$1 AND case_status <> 'Closed')::int AS active_cases,
             (SELECT COUNT(*) FROM assurance_action_items WHERE tenant_id=$1 AND owner_kind='company' AND action_status <> 'resolved')::int AS company_approvals_required,
             (SELECT COUNT(*) FROM assurance_action_items
                WHERE tenant_id=$1 AND action_status <> 'resolved' AND due_at < $2::timestamptz
                  AND (action_status <> 'snoozed' OR snoozed_until <= $2::timestamptz))::int AS overdue_actions`,
          [tenantId, nowIso]
        ),
        this.database.query<CountRow>(
          `SELECT case_status AS label, COUNT(*)::int AS count
             FROM assurance_cases
            WHERE tenant_id=$1 AND case_status <> 'Closed'
            GROUP BY case_status
            ORDER BY case_status`,
          [tenantId]
        ),
        this.database.query<CountRow>(
          `SELECT owner_kind AS label, COUNT(*)::int AS count
             FROM assurance_cases
            WHERE tenant_id=$1 AND case_status <> 'Closed' AND owner_kind IS NOT NULL
            GROUP BY owner_kind
            ORDER BY owner_kind`,
          [tenantId]
        ),
        this.database.query<ReadinessRow>(
          `SELECT
             COALESCE(targets.site_id, orders.site_id) AS scope_id,
             sites.name AS scope_name,
             COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE cases.case_status IN ('Approved','Conditionally approved'))::int AS assured,
             COUNT(*) FILTER (WHERE cases.case_status='Conditionally approved')::int AS conditional,
             COUNT(*) FILTER (WHERE cases.case_status IN ('Reassessment required','Rejected','Suspended'))::int AS attention,
             COUNT(*) FILTER (WHERE cases.case_status NOT IN ('Approved','Conditionally approved','Reassessment required','Rejected','Suspended'))::int AS in_progress
           FROM assurance_cases AS cases
           JOIN assurance_orders AS orders ON orders.order_id=cases.order_id AND orders.tenant_id=cases.tenant_id
           JOIN assurance_order_workers AS targets ON targets.target_id=cases.target_id AND targets.tenant_id=cases.tenant_id
           LEFT JOIN company_sites AS sites ON sites.tenant_id=cases.tenant_id AND sites.site_id=COALESCE(targets.site_id,orders.site_id)
           WHERE ${READINESS_CASE_FILTER} AND COALESCE(targets.site_id,orders.site_id) IS NOT NULL
           GROUP BY COALESCE(targets.site_id,orders.site_id),sites.name
           ORDER BY lower(COALESCE(sites.name,COALESCE(targets.site_id,orders.site_id))),COALESCE(targets.site_id,orders.site_id)`,
          [tenantId]
        ),
        this.database.query<ReadinessRow>(
          `SELECT
             COALESCE(targets.department_id, orders.department_id) AS scope_id,
             departments.name AS scope_name,
             COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE cases.case_status IN ('Approved','Conditionally approved'))::int AS assured,
             COUNT(*) FILTER (WHERE cases.case_status='Conditionally approved')::int AS conditional,
             COUNT(*) FILTER (WHERE cases.case_status IN ('Reassessment required','Rejected','Suspended'))::int AS attention,
             COUNT(*) FILTER (WHERE cases.case_status NOT IN ('Approved','Conditionally approved','Reassessment required','Rejected','Suspended'))::int AS in_progress
           FROM assurance_cases AS cases
           JOIN assurance_orders AS orders ON orders.order_id=cases.order_id AND orders.tenant_id=cases.tenant_id
           JOIN assurance_order_workers AS targets ON targets.target_id=cases.target_id AND targets.tenant_id=cases.tenant_id
           LEFT JOIN company_departments AS departments ON departments.tenant_id=cases.tenant_id AND departments.department_id=COALESCE(targets.department_id,orders.department_id)
           WHERE ${READINESS_CASE_FILTER} AND COALESCE(targets.department_id,orders.department_id) IS NOT NULL
           GROUP BY COALESCE(targets.department_id,orders.department_id),departments.name
           ORDER BY lower(COALESCE(departments.name,COALESCE(targets.department_id,orders.department_id))),COALESCE(targets.department_id,orders.department_id)`,
          [tenantId]
        ),
        this.database.query<GapRow>(
          `SELECT
             orders.credential_target,
             COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE cases.case_status IN ('Approved','Conditionally approved'))::int AS assured
           FROM assurance_cases AS cases
           JOIN assurance_orders AS orders ON orders.order_id=cases.order_id AND orders.tenant_id=cases.tenant_id
           JOIN assurance_order_workers AS targets ON targets.target_id=cases.target_id AND targets.tenant_id=cases.tenant_id
           WHERE ${READINESS_CASE_FILTER} AND orders.credential_target IS NOT NULL
           GROUP BY orders.credential_target
           ORDER BY lower(orders.credential_target),orders.credential_target`,
          [tenantId]
        )
      ]);

    const summaryRow = summaryResult.rows[0] ?? {
      total_orders: 0,
      active_orders: 0,
      active_cases: 0,
      company_approvals_required: 0,
      overdue_actions: 0
    };
    const summary = Object.freeze({
      totalOrders: number(summaryRow.total_orders),
      activeOrders: number(summaryRow.active_orders),
      activeCases: number(summaryRow.active_cases),
      companyApprovalsRequired: number(summaryRow.company_approvals_required),
      overdueActions: number(summaryRow.overdue_actions)
    });

    return Object.freeze({
      summary,
      workflowStages: Object.freeze(
        stageResult.rows.map((row) => Object.freeze({ status: row.label, count: number(row.count) }))
      ),
      pendingOwners: Object.freeze(
        ownerResult.rows.map((row) =>
          Object.freeze({ owner: row.label as AssurancePendingOwner, count: number(row.count) })
        )
      ),
      siteReadiness: Object.freeze(siteResult.rows.map(readiness)),
      departmentReadiness: Object.freeze(departmentResult.rows.map(readiness)),
      competencyGaps: Object.freeze(
        gapResult.rows.map((row) => {
          const total = number(row.total);
          const assured = number(row.assured);
          const gap = total - assured;
          return Object.freeze({
            credentialTarget: row.credential_target,
            total,
            assured,
            gap,
            gapPercent: percent(gap, total)
          });
        })
      )
    });
  }
}
