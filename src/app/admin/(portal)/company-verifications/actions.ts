"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requirePlatformPermission } from "@/lib/authorization/authorization-service";
import {
  CompanyVerificationAccessDeniedError,
  CompanyVerificationConflictError
} from "@/lib/company/company-verification-domain";
import { getCompanyVerificationService } from "@/lib/company/company-verification-service";

const CASE_ID_PATTERN = /^company_verification_[A-Za-z0-9_-]{24}$/;
const VERSION_ID_PATTERN = /^company_verification_version_[A-Za-z0-9_-]{24}$/;
const LOCK_VERSION_PATTERN = /^(?:0|[1-9]\d{0,9})$/;

type ReviewOutcome = "verified" | "changes_requested" | "rejected";

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function caseId(formData: FormData): string | null {
  const value = text(formData, "caseId");
  return CASE_ID_PATTERN.test(value) ? value : null;
}

function expectedReview(formData: FormData): {
  expectedVersionId: string;
  expectedLockVersion: number;
} | null {
  const expectedVersionId = text(formData, "expectedVersionId");
  const rawLockVersion = text(formData, "expectedLockVersion");
  if (!VERSION_ID_PATTERN.test(expectedVersionId) || !LOCK_VERSION_PATTERN.test(rawLockVersion)) {
    return null;
  }
  const expectedLockVersion = Number(rawLockVersion);
  if (!Number.isSafeInteger(expectedLockVersion)) return null;
  return { expectedVersionId, expectedLockVersion };
}

function outcome(formData: FormData): ReviewOutcome | null {
  const value = text(formData, "outcome");
  return value === "verified" || value === "changes_requested" || value === "rejected"
    ? value
    : null;
}

async function adminPrincipal() {
  return requirePlatformPermission({
    expectedRole: "admin",
    permission: "platform.tenants.manage"
  });
}

function refresh(caseReference: string): void {
  revalidatePath("/admin/company-verifications");
  revalidatePath(`/admin/company-verifications/${caseReference}`);
  revalidatePath("/company/dashboard");
  revalidatePath("/company/settings/profile");
}

function resultPath(status: "review-started" | "decision-recorded" | "conflict" | "denied" | "invalid"): string {
  return `/admin/company-verifications?result=${status}`;
}

export async function beginCompanyVerificationReviewAction(formData: FormData): Promise<void> {
  const reference = caseId(formData);
  const expected = expectedReview(formData);
  if (!reference || !expected) redirect(resultPath("invalid"));

  let result: "review-started" | "conflict" | "denied" = "review-started";
  try {
    const principal = await adminPrincipal();
    await getCompanyVerificationService().beginReview({
      principal,
      caseId: reference,
      ...expected
    });
    refresh(reference);
  } catch (error) {
    if (error instanceof CompanyVerificationConflictError) result = "conflict";
    else if (error instanceof CompanyVerificationAccessDeniedError) result = "denied";
    else throw error;
  }
  redirect(resultPath(result));
}

export async function decideCompanyVerificationAction(formData: FormData): Promise<void> {
  const reference = caseId(formData);
  const decision = outcome(formData);
  const expected = expectedReview(formData);
  if (!reference || !decision || !expected) redirect(resultPath("invalid"));

  let result: "decision-recorded" | "conflict" | "denied" = "decision-recorded";
  try {
    const principal = await adminPrincipal();
    await getCompanyVerificationService().decide({
      principal,
      caseId: reference,
      ...expected,
      outcome: decision
    });
    refresh(reference);
  } catch (error) {
    if (error instanceof CompanyVerificationConflictError) result = "conflict";
    else if (error instanceof CompanyVerificationAccessDeniedError) result = "denied";
    else throw error;
  }
  redirect(resultPath(result));
}
