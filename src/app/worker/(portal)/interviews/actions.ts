"use server";

import { revalidatePath } from "next/cache";

import { requireWorkerSession } from "@/lib/auth/worker-session";
import { getDatabaseClient } from "@/lib/database/database";
import { InterviewSchedulingService } from "@/lib/interview/interview-scheduling-service";

const EARLY_JOIN_MS = 30 * 60 * 1000;
const LATE_JOIN_MS = 4 * 60 * 60 * 1000;

export async function enterInterviewWaitingRoomAction(formData: FormData): Promise<void> {
  const interviewRequestId = String(formData.get("interviewRequestId") ?? "").trim();
  if (!interviewRequestId || interviewRequestId.length > 200) {
    throw new Error("Interview request is invalid.");
  }

  const session = await requireWorkerSession();
  const service = new InterviewSchedulingService(await getDatabaseClient());
  const request = await service.getWorkerInterview({
    workerAccountId: session.sub,
    interviewRequestId
  });
  if (!request.scheduledAt) throw new Error("Interview has not been scheduled.");

  const scheduledAt = Date.parse(request.scheduledAt);
  const now = Date.now();
  if (
    !Number.isFinite(scheduledAt) ||
    now < scheduledAt - EARLY_JOIN_MS ||
    now > scheduledAt + LATE_JOIN_MS
  ) {
    throw new Error("The interview waiting room is not open yet.");
  }

  await service.enterWaitingRoom({
    tenantId: request.tenantId,
    request,
    workerAccountId: session.sub
  });
  revalidatePath(`/worker/interviews/${interviewRequestId}`);
  revalidatePath("/worker/dashboard");
}
