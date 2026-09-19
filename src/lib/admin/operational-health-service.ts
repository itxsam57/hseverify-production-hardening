import type { DatabaseClient } from "../database/database";

export type OperationalHealthSnapshot = {
  users: number;
  companies: number;
  cases: number;
  rules: number;
  calibrations: number;
  integrations: number;
  auditEvents: number;
  generatedAt: string;
  status: "healthy" | "attention";
  warnings: string[];
};

export async function getOperationalHealthSnapshot(
  database?: DatabaseClient
): Promise<OperationalHealthSnapshot> {
  const client = database ?? (await (await import("../database/database")).getDatabaseClient());
  let result;
  try {
    result = await client.query<{
    users: string;
    companies: string;
    cases: string;
    rules: string;
    calibrations: string;
    integrations: string;
    audit_events: string;
  }>(`
    SELECT
      (SELECT count(*) FROM auth_accounts) AS users,
      (SELECT count(*) FROM company_registration_flows) AS companies,
      (SELECT count(*) FROM assurance_cases) AS cases,
      (SELECT count(*) FROM assurance_frameworks) AS rules,
      (SELECT count(*) FROM scoring_calibration_events) AS calibrations,
      (SELECT count(*) FROM platform_audit_events WHERE source_kind = 'integration') AS integrations,
      (SELECT count(*) FROM platform_audit_events) AS audit_events
  `);
  } catch {
    return {
      users: 0,
      companies: 0,
      cases: 0,
      rules: 0,
      calibrations: 0,
      integrations: 0,
      auditEvents: 0,
      status: "attention",
      warnings: ["Operational health database snapshot unavailable"],
      generatedAt: new Date().toISOString()
    };
  }

  const row = result.rows[0] ?? {
    users: "0",
    companies: "0",
    cases: "0",
    rules: "0",
    calibrations: "0",
    integrations: "0",
    audit_events: "0"
  };
  const values = {
    users: Number(row.users),
    companies: Number(row.companies),
    cases: Number(row.cases),
    rules: Number(row.rules),
    calibrations: Number(row.calibrations),
    integrations: Number(row.integrations),
    auditEvents: Number(row.audit_events)
  };
  const warnings = Object.entries(values)
    .filter(([, value]) => !Number.isInteger(value) || value < 0)
    .map(([name]) => `${name} aggregate is invalid`);

  return {
    ...values,
    status: warnings.length > 0 ? "attention" : "healthy",
    warnings,
    generatedAt: new Date().toISOString()
  };
}
