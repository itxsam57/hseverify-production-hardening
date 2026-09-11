"use server";

import { redirect } from "next/navigation";

import { getPublicVerificationRequestRuntime } from "@/lib/public-verification/public-verification-runtime";
import type { PublicVerificationLookupResult } from "@/lib/public-verification/public-verification-service";

export type PublicVerificationActionState = Readonly<{
  status: "idle" | "error" | "unavailable";
  message: string | null;
}>;

function state(
  status: Exclude<PublicVerificationActionState["status"], "idle">,
  message: string
): PublicVerificationActionState {
  return Object.freeze({ status, message });
}

export async function verifyPublicIdentifierAction(
  previousState: PublicVerificationActionState,
  formData: FormData
): Promise<PublicVerificationActionState> {
  void previousState;
  const raw = formData.get("identifier");
  const identifier = typeof raw === "string" ? raw : "";

  let result: PublicVerificationLookupResult;
  try {
    const { service, requestFingerprint } =
      await getPublicVerificationRequestRuntime();
    result = await service.lookupPublicVerification({
      rawIdentifier: identifier,
      requestFingerprint
    });
  } catch {
    return state(
      "unavailable",
      "Public verification is temporarily unavailable. Wait a few minutes and try again."
    );
  }

  if (result.kind === "redirect") {
    redirect(`/verify/result/${encodeURIComponent(result.publicToken)}`);
  }
  if (result.status === "temporarily_unavailable") {
    return state(
      "unavailable",
      "Public verification is temporarily unavailable. Wait a few minutes and try again."
    );
  }
  return state(
    "error",
    "We could not verify that identifier. Check it and try again."
  );
}
