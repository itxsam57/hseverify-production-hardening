"use server";

import type { PublicConcernActionState } from "@/lib/public-verification/public-concern-action-state";
import { getPublicConcernFileService } from "@/lib/public-verification/public-concern-file-service";
import { getPublicVerificationRequestRuntime } from "@/lib/public-verification/public-verification-runtime";

function formText(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function optionalEvidence(formData: FormData): File | null {
  const value = formData.get("evidence");
  return value instanceof File && value.size > 0 ? value : null;
}

function actionState(
  status: PublicConcernActionState["status"],
  message: string,
  concernReference: string | null = null
): PublicConcernActionState {
  return Object.freeze({ status, message, concernReference });
}

export async function submitPublicConcernAction(
  _previous: PublicConcernActionState,
  formData: FormData
): Promise<PublicConcernActionState> {
  try {
    const publicToken = formText(formData, "publicToken");
    const idempotencyNonce = formText(formData, "idempotencyNonce");
    const evidence = optionalEvidence(formData);
    const { service, requestFingerprint } =
      await getPublicVerificationRequestRuntime();

    const result = await service.submitPublicVerificationConcern({
      publicToken,
      requestFingerprint,
      category: formText(formData, "category"),
      description: formText(formData, "description"),
      contactName: formText(formData, "contactName"),
      contactEmail: formText(formData, "contactEmail"),
      contactPhone: formText(formData, "contactPhone"),
      idempotencyNonce
    });

    if (result.kind === "accepted") {
      if (evidence) {
        try {
          const fileService = await getPublicConcernFileService();
          const authority = await fileService.authorizeConcernUpload(
            result.concernReference
          );
          const upload = await fileService.uploadConcernEvidence({
            authority,
            requestFingerprint,
            idempotencyNonce,
            originalFilename: evidence.name,
            declaredMime: evidence.type,
            bytes: new Uint8Array(await evidence.arrayBuffer())
          });
          const evidenceMessage = upload.status === "bound"
            ? " The optional evidence passed its private scan and is attached."
            : upload.status === "rejected"
              ? " The concern was received, but the optional evidence did not pass the secure scan."
              : " The optional evidence is stored privately and queued for malware scanning; it will attach only if the scan passes.";
          return actionState(
            "success",
            `Your credential concern was received.${evidenceMessage} Keep the reference below if you need to follow up.`,
            result.concernReference
          );
        } catch {
          return actionState(
            "success",
            "Your credential concern was received, but the optional evidence could not be accepted safely. Keep the reference below; you can provide evidence during follow-up.",
            result.concernReference
          );
        }
      }

      return actionState(
        "success",
        "Your credential concern was received. Keep the reference below if you need to follow up.",
        result.concernReference
      );
    }
    if (result.kind === "validation_error") {
      return actionState("error", result.message);
    }
    if (result.status === "temporarily_unavailable") {
      return actionState(
        "error",
        "Concern reporting is temporarily unavailable. Wait a few minutes and try again."
      );
    }
    return actionState(
      "error",
      "The public verification reference is no longer available. Return to verification and check the identifier again."
    );
  } catch {
    return actionState(
      "error",
      "The concern could not be submitted safely. Wait a moment and try again."
    );
  }
}
