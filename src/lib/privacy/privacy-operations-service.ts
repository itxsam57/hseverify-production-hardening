import "server-only";
import { PrivacyOperationsRepository } from "./privacy-operations-repository";
import { assertPrivacyOwner, assertPrivacyTransition, assertRetentionTarget, completePrivacyRequest, completeRetentionJob, createAccommodation, createPrivacyRequest } from "./privacy-operations-domain";

export class PrivacyOperationsService {
  constructor(private readonly repository = new PrivacyOperationsRepository()) {}

  async request(input: Parameters<typeof createPrivacyRequest>[0]) {
    const request = createPrivacyRequest(input);
    await this.repository.createRequest(request);
    return request;
  }

  async accommodation(input: Parameters<typeof createAccommodation>[0]) {
    const accommodation = createAccommodation(input);
    await this.repository.addAccommodation(accommodation);
    return accommodation;
  }

  async listWorkerPrivacy(tenantId: string, workerId: string, ownerWorkerId: string): Promise<{
    requests: Array<{ request_id: string; request_type: string; status: string }>;
    accommodations: Array<{ accommodation_id: string; accommodation_type: string; status: string }>;
  }> {
    if (!tenantId) {
      throw new Error("tenant boundary required");
    }
    await this.ensureWorkerAccess({ workerId, ownerWorkerId });
    return {
      requests: await this.repository.listRequests(tenantId, workerId),
      accommodations: await this.repository.listAccommodations(tenantId, workerId),
    };
  }

  async complete(input: { requestId:string; workerId:string; tenantId:string; status:string }) {
    const request = completePrivacyRequest(input);
    await this.repository.completeRequest(request);
    return request;
  }

  async ensureWorkerAccess(input: { workerId: string; ownerWorkerId: string }) {
    assertPrivacyOwner(input);
    return { authorized: true };
  }

  async transition(input: { requestId: string; workerId: string; tenantId:string; from: string; to: string }) {
    assertPrivacyTransition(input);
    await this.repository.transitionRequest(input);
    return input;
  }

  async scheduleRetention(input: { id:string; tenantId:string; resourceType:string; before:string }) {
    const target = assertRetentionTarget(input);
    await this.repository.queueRetentionJob(target);
    return { ...input, status: "PENDING" as const };
  }

  async completeRetention(input: { id:string; tenantId:string; status:string }) {
    const job = completeRetentionJob(input);
    await this.repository.completeRetentionJob(job);
    return job;
  }
}
