import { getDatabaseClient } from "../database/database";
import type { ReportExportResult } from "./report-delivery-domain";

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
       ON CONFLICT (report_id, tenant_id) DO UPDATE SET status = EXCLUDED.status, schedule_at = EXCLUDED.schedule_at`,
      [record.reportId, record.tenantId, record.requestedBy, record.format, record.status, record.deliveryKey, scheduleAt ?? null]
    );
  }

  async find(reportId: string): Promise<ReportExportResult | null> {
    const client = await this.clientPromise;
    const result = await client.query(`SELECT * FROM report_deliveries WHERE report_id = $1`, [reportId]);
    const row = result.rows[0] as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      reportId: String(row.report_id), tenantId: String(row.tenant_id), requestedBy: String(row.requested_by),
      format: String(row.format) as ReportExportResult["format"], status: String(row.status) as ReportExportResult["status"],
      deliveryKey: String(row.delivery_key)
    };
  }
}
