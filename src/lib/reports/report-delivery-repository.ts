import { getDatabaseClient } from "../database/database";
import { assertReportTransition, type ReportExportResult } from "./report-delivery-domain";

export class ReportDeliveryRepository {
  private readonly clientPromise: Promise<Awaited<ReturnType<typeof getDatabaseClient>>>;

  constructor(clientPromise = getDatabaseClient()) {
    this.clientPromise = clientPromise;
  }

  async save(record: ReportExportResult, scheduleAt?: string): Promise<void> {
    const client = await this.clientPromise;
    await client.query(
      `INSERT INTO report_deliveries (report_id, tenant_id, requested_by, format, status, delivery_key, schedule_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (report_id, tenant_id) DO UPDATE SET
         format = EXCLUDED.format,
         schedule_at = EXCLUDED.schedule_at,
         delivery_key = EXCLUDED.delivery_key,
         requested_by = EXCLUDED.requested_by`,
      [record.reportId, record.tenantId, record.requestedBy, record.format, record.status, record.deliveryKey, scheduleAt ?? null]
    );
  }

  async find(reportId: string, tenantId?: string): Promise<ReportExportResult | null> {
    const client = await this.clientPromise;
    const result = await client.query(
      tenantId
        ? `SELECT * FROM report_deliveries WHERE report_id = $1 AND tenant_id = $2 ORDER BY created_at DESC LIMIT 1`
        : `SELECT * FROM report_deliveries WHERE report_id = $1 ORDER BY created_at DESC LIMIT 1`,
      tenantId ? [reportId, tenantId] : [reportId]
    );
    const row = result.rows[0] as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      reportId: String(row.report_id), tenantId: String(row.tenant_id), requestedBy: String(row.requested_by),
      format: String(row.format) as ReportExportResult["format"], status: String(row.status) as ReportExportResult["status"],
      deliveryKey: String(row.delivery_key)
    };
  }

  async listForTenant(tenantId: string): Promise<readonly ReportExportResult[]> {
    const client = await this.clientPromise;
    const result = await client.query(
      `SELECT * FROM report_deliveries WHERE tenant_id = $1 ORDER BY created_at DESC`,
      [tenantId]
    );
    return result.rows.map((value) => {
      const row = value as Record<string, unknown>;
      return ({
      reportId: String(row.report_id),
      tenantId: String(row.tenant_id),
      requestedBy: String(row.requested_by),
      format: String(row.format) as ReportExportResult["format"],
      status: String(row.status) as ReportExportResult["status"],
      deliveryKey: String(row.delivery_key)
      });
    });
  }

  async markStatus(reportId: string, tenantId: string, status: ReportExportResult["status"]): Promise<void> {
    const client = await this.clientPromise;
    const result = await client.query(
      `SELECT * FROM report_deliveries WHERE report_id = $1 AND tenant_id = $2 ORDER BY created_at DESC LIMIT 1`,
      [reportId, tenantId]
    );
    const row = result.rows[0] as Record<string, unknown> | undefined;
    const existing = row ? {
      reportId: String(row.report_id),
      tenantId: String(row.tenant_id),
      requestedBy: String(row.requested_by),
      format: String(row.format) as ReportExportResult["format"],
      status: String(row.status) as ReportExportResult["status"],
      deliveryKey: String(row.delivery_key)
    } : null;
    if (!existing || existing.tenantId !== tenantId) {
      throw new Error("Report delivery not found.");
    }
    assertReportTransition(existing.status, status);
    await client.query(
      `UPDATE report_deliveries SET status = $3 WHERE report_id = $1 AND tenant_id = $2`,
      [reportId, tenantId, status]
    );
  }
}
