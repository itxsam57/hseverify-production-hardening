import "server-only";

export const PRIVACY_REQUEST_TYPES = ["access", "correction", "deletion", "export"] as const;
export type PrivacyRequestType = typeof PRIVACY_REQUEST_TYPES[number];

export function createPrivacyRequest(input: { requestId:string; tenantId:string | null; workerId:string; type:PrivacyRequestType; details?:Record<string,unknown> }) {
  if (!input.workerId) throw new Error("worker boundary required");
  if (!PRIVACY_REQUEST_TYPES.includes(input.type)) throw new Error("invalid privacy request");
  return { ...input, details: input.details ?? {}, status: "OPEN" as const };
}

export function assertPrivacyOwner(input: { workerId: string; ownerWorkerId: string }) {
  if (!input.workerId || input.workerId !== input.ownerWorkerId) {
    throw new Error("privacy owner mismatch");
  }
}

export function completePrivacyRequest(input: { status:string; requestId:string; workerId:string; tenantId:string | null }) {
  if (!input.requestId || !input.workerId) throw new Error("request owner required");
  if (input.status !== "OPEN") throw new Error("invalid privacy transition");
  return { ...input, status: "COMPLETED" as const };
}

export function assertPrivacyTransition(input: { from: string; to: string; tenantId:string | null; workerId:string; requestId:string }) {
  if (!input.workerId || !input.requestId) throw new Error("request boundary required");
  const allowed = input.from === "OPEN" && ["PROCESSING", "COMPLETED", "REJECTED"].includes(input.to);
  if (!allowed) throw new Error("invalid privacy transition");
  return input;
}

export function createAccommodation(input: { id:string; tenantId:string | null; workerId:string; type:string; details?:Record<string,unknown> }) {
  if (!input.workerId || !input.type) throw new Error("invalid accommodation");
  return { ...input, details: input.details ?? {}, status: "REQUESTED" as const };
}

export function assertRetentionTarget(input: { id:string; tenantId:string; resourceType:string; before:string }) {
  if (!input.tenantId || !input.resourceType || !input.before) throw new Error("retention target required");
  if (Number.isNaN(Date.parse(input.before))) throw new Error("invalid retention date");
  return input;
}

export function completeRetentionJob(input: { id:string; tenantId:string; status:string }) {
  if (!input.id || !input.tenantId) throw new Error("retention job boundary required");
  if (input.status !== "PENDING") throw new Error("invalid retention transition");
  return { ...input, status: "COMPLETED" as const };
}
