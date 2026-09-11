import { redirect } from "next/navigation";

import { verifyPublicVerificationCapability } from "@/lib/public-verification/public-verification-capability";
import { getPublicVerificationSecret } from "@/lib/public-verification/public-verification-runtime";

export default async function PublicVerificationQrRoute({
  params
}: {
  params: Promise<{ publicToken: string }>;
}): Promise<never> {
  const { publicToken } = await params;
  const capability = verifyPublicVerificationCapability(
    publicToken,
    getPublicVerificationSecret(),
    new Date()
  );
  if (!capability) {
    redirect("/verify");
  }
  redirect(`/verify/result/${encodeURIComponent(publicToken)}`);
}