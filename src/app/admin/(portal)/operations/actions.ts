"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requirePlatformPermission } from "@/lib/authorization/authorization-service";
import {
  getProductionLaunchService,
  ReleaseHandoverConflictError,
  ReleaseHandoverInputError
} from "@/lib/operations/production-launch-service";

const text = (formData: FormData, name: string) => {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
};

export async function updateProductionLaunchCheckAction(formData: FormData): Promise<void> {
  const principal = await requirePlatformPermission({
    expectedRole: "admin",
    permission: "platform.operations.manage"
  });
  const name = text(formData, "checkName");
  const status = text(formData, "status");
  const revisionText = text(formData, "expectedRevision");
  const expectedRevision = /^\d+$/.test(revisionText) ? Number(revisionText) : Number.NaN;
  let result = "updated";

  try {
    await (await getProductionLaunchService()).updateCheck(principal, {
      name,
      status,
      expectedRevision
    });
    revalidatePath("/admin/operations", "page");
  } catch (error) {
    if (error instanceof ReleaseHandoverConflictError) {
      result = "conflict";
    } else if (error instanceof ReleaseHandoverInputError) {
      result = "invalid";
    } else {
      throw error;
    }
  }

  redirect(`/admin/operations?result=${result}`);
}
