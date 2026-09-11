import "server-only";

import { hashOpaqueValue } from "@/lib/auth/auth-domain";
import { getAuthAccessRepository } from "@/lib/auth/auth-access-repository";
import { getServerEnvironment } from "@/lib/config/server-environment";

const STAFF_ENROLLMENT_WINDOW_MS = 10 * 60 * 1000;
const MAX_STAFF_PROFILE_ATTEMPTS = 10;

export async function enforceStaffProfileEnrollmentRateLimit(
  combinedToken: string,
  now: Date = new Date()
): Promise<void> {
  const environment = getServerEnvironment();
  const attempts = await (
    await getAuthAccessRepository()
  ).consumeAccessRateLimit({
    action: "staff_invitation",
    bucketKey: hashOpaqueValue(
      combinedToken,
      environment.authPepper,
      "staff-enrollment-profile-rate-limit"
    ),
    now: now.toISOString(),
    resetBefore: new Date(
      now.getTime() - STAFF_ENROLLMENT_WINDOW_MS
    ).toISOString()
  });
  if (attempts > MAX_STAFF_PROFILE_ATTEMPTS) {
    throw new Error("Too many staff enrollment attempts. Wait before trying again.");
  }
}
