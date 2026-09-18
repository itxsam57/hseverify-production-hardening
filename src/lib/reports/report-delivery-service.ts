// @ts-expect-error Runtime test execution loads TypeScript modules directly.
import { createReportExportRequest, type ReportExportRequest, type ReportFormat } from "./report-delivery-domain.ts";

type ReportDeliveryWriter = {
  save(record: unknown, scheduleAt?: string): Promise<void>;
  find(reportId: string, tenantId?: string): Promise<unknown | null>;
  markStatus(reportId: string, tenantId: string, status: "processing" | "delivered" | "failed"): Promise<void>;
};

export class ReportDeliveryService {
  private readonly repository: ReportDeliveryWriter;

  constructor(repository: ReportDeliveryWriter) {
    this.repository = repository;
  }

  async queue(request: ReportExportRequest) {
    const result = createReportExportRequest(request);
    await this.repository.save(result, request.scheduleAt);
    return result;
  }

  async schedule(request: ReportExportRequest) {
    if (!request.scheduleAt) {
      throw new Error("Schedule time is required.");
    }
    return this.queue(request);
  }

  async deliver(reportId: string, tenantId: string, format: ReportFormat) {
    const existing = await this.repository.find(reportId, tenantId);
    if (!existing) {
      throw new Error("Report delivery not found.");
    }
    await this.repository.markStatus(reportId, tenantId, "processing");
    await this.repository.markStatus(reportId, tenantId, "delivered");
    return { reportId, tenantId, format, status: "delivered" as const };
  }
}
