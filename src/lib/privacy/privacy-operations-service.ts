import "server-only";

import type { ContactCityCorrection, RecordingDeletion } from "./privacy-execution";
import { createIdentifier } from "../auth/auth-domain";
import { PrivacyOperationsRepository } from "./privacy-operations-repository";
import {
  assertPrivacyOwner,
  assertPrivacyTransition,
  assertRetentionTarget,
  completePrivacyRequest,
  completeRetentionJob,
  createAccommodation,
  createPrivacyRequest
} from "./privacy-operations-domain";

export type AccommodationAdjustment = Readonly<{
  timeMultiplier: number;
  extraBreakMinutes: number;
  screenReader: boolean;
  captions: boolean;
  interpreter: boolean;
  reducedMotion: boolean;
}>;

function normalizeReviewReason(value: string): string {
  const reason = value.trim();
  if (reason.length < 10 || reason.length > 2000) {
    throw new Error("Accommodation review reason must be between 10 and 2000 characters.");
  }
  return reason;
}

export function normalizeAccommodationAdjustment(input: {
  timeMultiplier?: unknown;
  extraBreakMinutes?: unknown;
  screenReader?: unknown;
  captions?: unknown;
  interpreter?: unknown;
  reducedMotion?: unknown;
}): AccommodationAdjustment {
  const timeMultiplier = Number(input.timeMultiplier ?? 1);
  const extraBreakMinutes = Number(input.extraBreakMinutes ?? 0);
  if (!Number.isFinite(timeMultiplier) || timeMultiplier < 1 || timeMultiplier > 2) {
    throw new Error("Accommodation time multiplier must be between 1 and 2.");
  }
  if (!Number.isInteger(extraBreakMinutes) || extraBreakMinutes < 0 || extraBreakMinutes > 60) {
    throw new Error("Accommodation break allowance must be between 0 and 60 minutes.");
  }
  return Object.freeze({
    timeMultiplier,
    extraBreakMinutes,
    screenReader: Boolean(input.screenReader),
    captions: Boolean(input.captions),
    interpreter: Boolean(input.interpreter),
    reducedMotion: Boolean(input.reducedMotion)
  });
}

export class PrivacyOperationsService {
  constructor(private readonly repository = new PrivacyOperationsRepository()) {}

  async request(input: Parameters<typeof createPrivacyRequest>[0]) {
    const request = createPrivacyRequest(input);
    await this.repository.createRequest(request);
    return request;
  }

  async listOwnedShareLinks(workerId: string) {
    if (!workerId.trim()) throw new Error("Privacy Worker boundary is required.");
    return this.repository.listOwnedShareLinks(workerId);
  }

  async listRequestReviewQueue() {
    return this.repository.listRequestReviewQueue();
  }

  async reviewRequest(input: {
    requestId: string; reviewerAccountId: string; expectedStatus: string;
    decision: "PROCESSING" | "REJECTED" | "COMPLETED"; reason: string;
    reviewerSessionId?: string; approvedCorrection?: ContactCityCorrection; approvedDeletion?: RecordingDeletion;
  }) {
    const reason = input.reason.trim();
    if (!input.requestId || !input.reviewerAccountId || reason.length < 10 || reason.length > 2000 ||
        !["PROCESSING", "REJECTED", "COMPLETED"].includes(input.decision)) {
      throw new Error("Privacy request review requires a valid decision and a reason between 10 and 2000 characters.");
    }
    return this.repository.reviewRequest({ ...input, reason, reviewId: createIdentifier("privacy_review"), now: new Date().toISOString() });
  }

  async downloadWorkerData(requestId: string, workerId: string) {
    if (!requestId.trim() || requestId.length > 200 || !workerId.trim()) {
      throw new Error("Worker data is unavailable.");
    }
    return this.repository.downloadWorkerData(requestId,workerId,new Date().toISOString());
  }

  async accommodation(input: Parameters<typeof createAccommodation>[0]) {
    const accommodation = createAccommodation(input);
    await this.repository.addAccommodation(accommodation);
    return accommodation;
  }

  async listWorkerPrivacy(tenantId: string | null, workerId: string, ownerWorkerId: string) {
    await this.ensureWorkerAccess({ workerId, ownerWorkerId });
    return {
      requests: await this.repository.listRequests(tenantId, workerId),
      accommodations: await this.repository.listAccommodations(tenantId, workerId)
    };
  }

  async listAccommodationReviewQueue() {
    const rows = await this.repository.listAccommodationReviewQueue();
    return Promise.all(rows.map(async (row) => ({
      ...row,
      cases: await this.repository.listWorkerCases(row.worker_id)
    })));
  }

  async reviewAccommodation(input: {
    accommodationId: string;
    reviewerAccountId: string;
    decision: "APPROVED" | "DECLINED";
    reason: string;
    caseId?: string | null;
    adjustment?: Parameters<typeof normalizeAccommodationAdjustment>[0];
    now?: Date;
  }) {
    const reason = normalizeReviewReason(input.reason);
    const adjustment =
      input.decision === "APPROVED"
        ? normalizeAccommodationAdjustment(input.adjustment ?? {})
        : null;
    return this.repository.reviewAccommodation({
      accommodationId: input.accommodationId,
      reviewerAccountId: input.reviewerAccountId,
      decision: input.decision,
      reason,
      caseId: input.decision === "APPROVED" ? input.caseId ?? null : null,
      adjustment,
      overlayId: input.decision === "APPROVED" ? createIdentifier("accommodation_overlay") : null,
      now: (input.now ?? new Date()).toISOString()
    });
  }

  async complete(input: { requestId:string; workerId:string; tenantId:string | null; status:string }) {
    completePrivacyRequest(input);
    throw new Error("Privacy completion requires an authorized fulfilment review.");
  }

  async ensureWorkerAccess(input: { workerId: string; ownerWorkerId: string }) {
    assertPrivacyOwner(input);
    return { authorized: true };
  }

  async transition(input: { requestId: string; workerId: string; tenantId:string | null; from: string; to: string }) {
    assertPrivacyTransition(input);
    if (input.to === "COMPLETED") throw new Error("Privacy completion requires an authorized fulfilment review.");
    await this.repository.transitionRequest(input);
    return input;
  }

  async scheduleRetention(input: { id:string; tenantId:string; resourceType:string; before:string }) {
    const target = assertRetentionTarget(input);
    await this.repository.queueRetentionJob(target);
    return { ...input, status: "PENDING" as const };
  }

  async currentContactCorrectionVersion(workerId:string) {return this.repository.currentContactCorrectionVersion(workerId);}

  async listOwnedRecordingAssets(workerId:string) {
    if (!workerId.trim()) throw new Error("Worker boundary is required.");
    return this.repository.listOwnedRecordingAssets(workerId);
  }

  async listRetentionTenants() {return this.repository.listRetentionTenants();}

  async listRetentionJobs() {return this.repository.listRetentionJobs();}

  async completeRetention(input: { id:string;tenantId:string;status:string;reviewerAccountId?:string;reviewerSessionId?:string;reason?:string }) {
    completeRetentionJob(input);
    const reason=input.reason?.trim()??"";
    if (!input.reviewerAccountId || !input.reviewerSessionId || reason.length<10 || reason.length>2000) {
      throw new Error("Retention execution requires authorized Admin approval and a reason.");
    }
    return this.repository.completeRetentionJob({...input,reviewerAccountId:input.reviewerAccountId,reason,now:new Date().toISOString()});
  }
}
