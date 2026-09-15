// @ts-expect-error Runtime test execution loads TypeScript modules directly.
import { createReportExportRequest, type ReportExportRequest } from "./report-delivery-domain.ts";

type ReportDeliveryWriter = {
  save(record: unknown, scheduleAt?: string): Promise<void>;
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
}
