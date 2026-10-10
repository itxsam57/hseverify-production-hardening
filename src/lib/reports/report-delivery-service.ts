import "server-only";
import type { OutboxJobRecord, TrustedOutboxLease } from "../outbox/outbox-domain";
import type { PrivateObjectStorage } from "../secure-files/private-object-storage-core";
import { createRuntimePrivateObjectStorage } from "../secure-files/private-object-storage";
import { getServerEnvironment } from "../config/server-environment";
import { ReportInputError, type ReportExportRequest } from "./report-delivery-domain";
import {
  ReportDeliveryRepository, type ReportExportPrincipal, type ReportReadPrincipal
} from "./report-delivery-repository";

export class ReportDeliveryService {
  constructor(
    private readonly repository: ReportDeliveryRepository = new ReportDeliveryRepository(),
    private readonly suppliedStorage?: PrivateObjectStorage
  ) {}
  private storage(): PrivateObjectStorage {
    return this.suppliedStorage ?? createRuntimePrivateObjectStorage(getServerEnvironment().appEnvironment);
  }
  async queue(request: ReportExportRequest, principal: ReportExportPrincipal) {
    return this.repository.queue(request, principal);
  }
  async schedule(request: ReportExportRequest, principal: ReportExportPrincipal) {
    if (!request.scheduleAt) throw new ReportInputError("Schedule time is required.");
    return this.queue(request, principal);
  }
  async workspace(principal: ReportReadPrincipal) { return this.repository.workspace(principal); }
  async retry(principal: ReportExportPrincipal, reportId: string) { return this.repository.retry(principal, reportId); }
  async download(principal: ReportExportPrincipal, reportId: string) {
    return this.repository.download(principal, reportId, this.storage());
  }
  async generate(job: OutboxJobRecord, lease: TrustedOutboxLease) {
    return this.repository.generate(job, lease, this.storage());
  }
}
