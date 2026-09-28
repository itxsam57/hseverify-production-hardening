"use server";

import { redirect } from "next/navigation";

import { requirePlatformPermission } from "@/lib/authorization/authorization-service";
import {
  ensureAssessmentAccessContext
} from "@/lib/assessment-attempt/assessment-device-cookie";
import {
  AssessmentPrecheckError,
  getAssessmentPrecheckService
} from "@/lib/assessment-attempt/assessment-precheck-service";
import {
  AssessmentRecoveryAccessError,
  AssessmentRecoveryConflictError,
  AssessmentRecoveryInputError,
  getAssessmentRecoveryService
} from "@/lib/assessment-attempt/assessment-recovery-service";
import {
  AssessmentAttemptAccessError,
  AssessmentAttemptConflictError,
  AssessmentAttemptInputError,
  getAssessmentAttemptService
} from "@/lib/assessment-attempt/assessment-attempt-service";

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}
function yes(formData: FormData, name: string): boolean {
  return text(formData, name) === "yes";
}
function precheckUrl(caseId: string, catalogueVersionId: string, error?: string): string {
  const query = new URLSearchParams({ caseId, catalogueVersionId });
  if (error) query.set("error", error);
  return `/worker/available-assessments/precheck?${query.toString()}`;
}

export async function beginAssessmentAction(formData: FormData): Promise<never> {
  const caseId = text(formData, "caseId");
  const catalogueVersionId = text(formData, "catalogueVersionId");
  redirect(precheckUrl(caseId, catalogueVersionId));
}

export async function completeAssessmentPrecheckAction(formData: FormData): Promise<never> {
  const caseId = text(formData, "caseId");
  const catalogueVersionId = text(formData, "catalogueVersionId");
  const principal = await requirePlatformPermission({
    expectedRole: "worker",
    permission: "worker.assessments.read"
  });

  try {
    const accessContext = await ensureAssessmentAccessContext();
    const recorded = await getAssessmentPrecheckService().recordPassed(
      principal,
      accessContext,
      {
        caseId,
        catalogueVersionId,
        supportedBrowser: yes(formData, "supportedBrowser"),
        connectionOk: yes(formData, "connectionOk"),
        cameraOk: yes(formData, "cameraOk"),
        microphoneOk: yes(formData, "microphoneOk"),
        screenShareOk: yes(formData, "screenShareOk"),
        fullscreenCapable: yes(formData, "fullscreenCapable"),
        identityReconfirmed: yes(formData, "identityReconfirmed"),
        environmentDeclared: yes(formData, "environmentDeclared"),
        monitoringConsented: yes(formData, "monitoringConsented"),
        diagnostics: {
          client: text(formData, "clientDiagnostic").slice(0, 240)
        }
      }
    );
    const result = await (await getAssessmentAttemptService()).begin(
      principal,
      {
        caseId,
        catalogueVersionId,
        precheckId: recorded.precheckId,
        accessContext
      }
    );
    redirect(`/worker/assessments/${result.attempt.attemptId}`);
  } catch (error) {
    if (
      error instanceof AssessmentPrecheckError ||
      error instanceof AssessmentAttemptAccessError ||
      error instanceof AssessmentAttemptConflictError ||
      error instanceof AssessmentAttemptInputError
    ) {
      redirect(precheckUrl(caseId, catalogueVersionId, error.message));
    }
    throw error;
  }
}

export async function resumeAssessmentAction(formData: FormData): Promise<never> {
  const attemptId = text(formData, "attemptId");
  const principal = await requirePlatformPermission({
    expectedRole: "worker",
    permission: "worker.assessments.read"
  });
  try {
    const accessContext = await ensureAssessmentAccessContext();
    const result = await (await getAssessmentAttemptService()).resume(
      principal,
      attemptId,
      accessContext
    );
    redirect(`/worker/assessments/${result.attempt.attemptId}`);
  } catch (error) {
    if (
      error instanceof AssessmentAttemptAccessError ||
      error instanceof AssessmentAttemptConflictError ||
      error instanceof AssessmentAttemptInputError
    ) {
      redirect(`/worker/available-assessments?recoveryError=${encodeURIComponent(error.message)}`);
    }
    throw error;
  }
}


export async function requestAssessmentRecoveryAction(formData: FormData): Promise<never> {
  const attemptId = text(formData, "attemptId");
  const requestReason = text(formData, "requestReason");
  const principal = await requirePlatformPermission({
    expectedRole: "worker",
    permission: "worker.assessments.read"
  });
  try {
    await getAssessmentRecoveryService().requestReview(
      principal,
      attemptId,
      requestReason
    );
    redirect("/worker/available-assessments?recoveryRequested=yes");
  } catch (error) {
    if (
      error instanceof AssessmentRecoveryAccessError ||
      error instanceof AssessmentRecoveryConflictError ||
      error instanceof AssessmentRecoveryInputError
    ) {
      redirect(`/worker/available-assessments?recoveryError=${encodeURIComponent(error.message)}`);
    }
    throw error;
  }
}
