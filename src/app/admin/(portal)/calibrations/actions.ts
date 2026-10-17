"use server";

import { redirect } from "next/navigation";

import { requirePortalAuthorization } from "@/lib/authorization/authorization-service";
import {
  getStaffCalibrationService,
  StaffCalibrationInputError,
  type StaffCalibrationStatus
} from "@/lib/review/staff-calibration-service";

function value(formData: FormData, name: string): string {
  const item = formData.get(name);
  return typeof item === "string" ? item : "";
}

export async function recordStaffCalibrationAction(formData: FormData): Promise<void> {
  const principal = await requirePortalAuthorization("admin");
  try {
    const validFrom = new Date(value(formData, "validFrom"));
    const validUntil = new Date(value(formData, "validUntil"));
    if (Number.isNaN(validFrom.getTime()) || Number.isNaN(validUntil.getTime())) {
      throw new StaffCalibrationInputError("Calibration dates are invalid.");
    }
    await getStaffCalibrationService().record(principal, {
      accountId: value(formData, "accountId"),
      role: value(formData, "role") as "verifier" | "assessor",
      frameworkReference: value(formData, "frameworkReference"),
      frameworkVersionId: value(formData, "frameworkVersionId") || undefined,
      status: value(formData, "status") as StaffCalibrationStatus,
      validFrom,
      validUntil,
      note: value(formData, "note")
    });
  } catch (error) {
    const message = error instanceof StaffCalibrationInputError ? error.message : "Calibration could not be recorded.";
    redirect(`/admin/calibrations?error=${encodeURIComponent(message)}`);
  }
  redirect("/admin/calibrations?result=recorded");
}
