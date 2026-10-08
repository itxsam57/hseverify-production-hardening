"use server";

import { notFound, redirect } from "next/navigation";

import { revalidatePath } from "next/cache";

import { requirePortalAuthorization } from "@/lib/authorization/authorization-service";
import { getDatabaseClient } from "@/lib/database/database";
import { InterviewRuntimeAccessError, InterviewRuntimeConflictError, InterviewRuntimeInputError, InterviewRuntimeService } from "@/lib/interview/interview-runtime-service";
import { InterviewSchedulingInputError } from "@/lib/interview/interview-scheduling-domain";
import { InterviewSchedulingService } from "@/lib/interview/interview-scheduling-service";

const EARLY_JOIN_MS = 30 * 60 * 1000;
const LATE_JOIN_MS = 4 * 60 * 60 * 1000;

export async function enterInterviewWaitingRoomAction(formData: FormData): Promise<void> {
  const interviewRequestId = String(formData.get("interviewRequestId") ?? "").trim();
  if (!interviewRequestId || interviewRequestId.length > 200) {
    throw new Error("Interview request is invalid.");
  }

  const principal = await requirePortalAuthorization("worker");
  const database = await getDatabaseClient();
  const service = new InterviewSchedulingService(database);
  const request = await service.getWorkerInterview({
    workerAccountId: principal.accountId,
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

  await database.transaction(async (transaction) => {
    const scheduling = new InterviewSchedulingService(transaction);
    await scheduling.enterWaitingRoom({
      tenantId: request.tenantId,
      request,
      workerAccountId: principal.accountId
    });
    await new InterviewRuntimeService(Promise.resolve(transaction)).enterWaitingRoom(
      principal,
      interviewRequestId
    );
  });
  revalidatePath(`/worker/interviews/${interviewRequestId}`);
  revalidatePath("/worker/dashboard");
}

export async function markInterviewReadyAction(formData: FormData): Promise<void> {
  const interviewRequestId = String(formData.get("interviewRequestId") ?? "").trim();
  if (!interviewRequestId) throw new Error("Interview request is invalid.");

  const principal = await requirePortalAuthorization("worker");
  await new InterviewRuntimeService().markWorkerReady(principal, interviewRequestId, {
    cameraReady: String(formData.get("cameraReady") ?? "") === "yes",
    microphoneReady: String(formData.get("microphoneReady") ?? "") === "yes",
    connectionReady: String(formData.get("connectionReady") ?? "") === "yes",
    identityConfirmed: String(formData.get("identityConfirmed") ?? "") === "yes",
    recordingConsent: String(formData.get("recordingConsent") ?? "") === "yes"
  });
  revalidatePath(`/worker/interviews/${interviewRequestId}`);
}

export async function reportWorkerInterviewTechnicalIssueAction(formData: FormData): Promise<void> {
  const interviewRequestId = String(formData.get("interviewRequestId") ?? "").trim();
  const issue = String(formData.get("issue") ?? "").trim();
  const principal = await requirePortalAuthorization("worker");
  if (!interviewRequestId || interviewRequestId.length > 200) notFound();
  try {
    await new InterviewRuntimeService().technicalIssue(principal, interviewRequestId, issue);
  } catch (error: unknown) {
    if (error instanceof InterviewRuntimeAccessError) notFound();
    if (error instanceof InterviewRuntimeInputError || error instanceof InterviewRuntimeConflictError) {
      redirect("/worker/interviews/" + encodeURIComponent(interviewRequestId) + "?technicalError=invalid");
    }
    throw error;
  }
  revalidatePath("/worker/interviews/" + interviewRequestId);
  redirect("/worker/interviews/" + encodeURIComponent(interviewRequestId) + "?technicalSaved=yes");
}
export async function saveInterviewAvailabilityAction(formData:FormData):Promise<void> {
  const principal=await requirePortalAuthorization("worker");
  const interviewRequestId=String(formData.get("interviewRequestId")??"").trim();
  if(!interviewRequestId || interviewRequestId.length>200)throw new Error("Interview request is invalid.");
  try{
    await new InterviewSchedulingService(await getDatabaseClient()).setWorkerAvailability({
      principal,interviewRequestId,availableFrom:String(formData.get("availableFrom")??""),availableUntil:String(formData.get("availableUntil")??"")
    });
  }catch(error:unknown){
    if(error instanceof InterviewSchedulingInputError)redirect("/worker/interviews/"+encodeURIComponent(interviewRequestId)+"?availabilityError=invalid");
    throw error;
  }
  revalidatePath("/worker/interviews/"+interviewRequestId);
  revalidatePath("/assessor/interviews");
  redirect("/worker/interviews/"+encodeURIComponent(interviewRequestId)+"?availabilitySaved=yes");
}
