"use server";

import { revalidatePath } from "next/cache";
import { requireCurrentTenantPermission } from "@/lib/authorization/authorization-service";
import { getDatabaseClient } from "@/lib/database/database";
import { getServerEnvironment } from "@/lib/config/server-environment";
import {
  CompanyWorkforceAccessError,
  CompanyWorkforceConflictError,
  CompanyWorkforceInputError
} from "@/lib/company/company-workforce-domain";
import { CompanyWorkforceService } from "@/lib/company/company-workforce-service";

export type EndWorkerRelationshipState = Readonly<{
  status: "idle" | "success" | "error" | "conflict";
  message: string | null;
}>;

export async function endWorkerRelationshipAction(
  linkId: string,
  _previous: EndWorkerRelationshipState,
  formData: FormData
): Promise<EndWorkerRelationshipState> {
  try {
    if (formData.get("confirm") !== "on") {
      throw new CompanyWorkforceInputError("Confirm that this Company relationship should end.");
    }
    const principal = await requireCurrentTenantPermission("company.workforce.manage");
    const environment = getServerEnvironment();
    const service = new CompanyWorkforceService(await getDatabaseClient(), environment.authPepper);
    await service.endWorkerRelationship(principal, {
      linkId,
      reason: typeof formData.get("reason") === "string" ? String(formData.get("reason")) : "",
      effectiveDate: typeof formData.get("effectiveDate") === "string"
        ? String(formData.get("effectiveDate"))
        : ""
    });
    revalidatePath("/company/workers");
    revalidatePath(`/company/workers/${encodeURIComponent(linkId)}`);
    revalidatePath("/company/dashboard");
    revalidatePath("/worker/company-access");
    return { status: "success", message: "Company relationship ended. The Worker identity and prior history remain intact." };
  } catch (error) {
    if (error instanceof CompanyWorkforceConflictError) {
      return { status: "conflict", message: error.message };
    }
    if (error instanceof CompanyWorkforceInputError) {
      return { status: "error", message: error.message };
    }
    if (error instanceof CompanyWorkforceAccessError) {
      return { status: "error", message: "This Company session cannot change that Worker relationship." };
    }
    return { status: "error", message: "The Worker relationship could not be ended safely." };
  }
}
