"use server";

import { redirect } from "next/navigation";

import { requirePlatformPermission } from "@/lib/authorization/authorization-service";
import {
  AssessmentRecoveryAccessError,
  AssessmentRecoveryConflictError,
  AssessmentRecoveryInputError,
  getAssessmentRecoveryService
} from "@/lib/assessment-attempt/assessment-recovery-service";

function value(formData: FormData, name: string): string {
  const item = formData.get(name);
  return typeof item === "string" ? item.trim() : "";
}

function fail(error: unknown): never {
  const message =
    error instanceof AssessmentRecoveryAccessError ||
    error instanceof AssessmentRecoveryConflictError ||
    error instanceof AssessmentRecoveryInputError
      ? error.message
      : "Assessment recovery operation could not be completed safely.";
  redirect(`/verifier/assessment-recovery?error=${encodeURIComponent(message)}`);
}

async function verifierPrincipal() {
  return requirePlatformPermission({
    expectedRole: "verifier",
    permission: "verification.assigned.decide"
  });
}

export async function claimAssessmentRecoveryAction(formData: FormData): Promise<never> {
  try {
    const principal = await verifierPrincipal();
    await getAssessmentRecoveryService().claim(principal, value(formData, "reviewId"));
  } catch (error) {
    fail(error);
  }
  redirect("/verifier/assessment-recovery?result=claimed");
}

export async function decideAssessmentRecoveryAction(formData: FormData): Promise<never> {
  try {
    const principal = await verifierPrincipal();
    const decision = value(formData, "decision");
    if (decision !== "APPROVE_REPLACEMENT" && decision !== "ALLOW_RESUME") {
      throw new AssessmentRecoveryInputError("Recovery decision is invalid.");
    }
    await getAssessmentRecoveryService().decide(
      principal,
      value(formData, "reviewId"),
      decision,
      value(formData, "decisionReason")
    );
  } catch (error) {
    fail(error);
  }
  redirect("/verifier/assessment-recovery?result=decided");
}
