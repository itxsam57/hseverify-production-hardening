import { NextResponse } from "next/server";

import { writeStaffEnrollmentTokenToResponse } from "@/lib/auth/staff-enrollment-cookie";
import {
  StaffProvisioningError,
  getStaffProvisioningService
} from "@/lib/auth/staff-provisioning-service";

function relativeRedirect(location: string): NextResponse {
  return new NextResponse(null, {
    status: 307,
    headers: { Location: location }
  });
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ token: string }> }
): Promise<NextResponse> {
  const { token } = await context.params;
  try {
    const result = await (await getStaffProvisioningService()).beginEnrollment(token);
    const response = relativeRedirect("/staff/invite/accept");
    writeStaffEnrollmentTokenToResponse(response, result.token);
    return response;
  } catch (error) {
    const reason =
      error instanceof StaffProvisioningError
        ? error.code
        : "invitation_unavailable";
    return relativeRedirect(
      `/staff/invite/accept?reason=${encodeURIComponent(reason)}`
    );
  }
}
