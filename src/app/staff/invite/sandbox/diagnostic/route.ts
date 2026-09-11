import { headers } from "next/headers";
import { NextResponse } from "next/server";

import { hashOpaqueValue } from "@/lib/auth/auth-domain";
import { readStaffEnrollmentToken } from "@/lib/auth/staff-enrollment-cookie";
import { getStaffProvisioningService } from "@/lib/auth/staff-provisioning-service";
import { getServerEnvironment } from "@/lib/config/server-environment";
import { getDatabaseClient } from "@/lib/database/database";

export const dynamic = "force-dynamic";

function cookieNames(value: string | null): string[] {
  if (!value) return [];
  return value
    .split(";")
    .map((part) => part.trim().split("=", 1)[0] ?? "")
    .filter(Boolean);
}

export async function GET(): Promise<NextResponse> {
  const environment = getServerEnvironment();
  if (!environment.authSandboxEnabled) {
    return NextResponse.json({ unavailable: true }, { status: 404 });
  }

  const requestHeaders = await headers();
  const rawCookieHeader = requestHeaders.get("cookie");
  const rawCookieNames = cookieNames(rawCookieHeader);
  const expectedCookieName =
    process.env.NODE_ENV === "production"
      ? "__Secure-hse_staff_enrollment"
      : "hse_staff_enrollment";
  const combinedToken = await readStaffEnrollmentToken();
  const requestCookieState = {
    rawCookieHeaderPresent: Boolean(rawCookieHeader),
    rawCookieNames,
    expectedCookieName,
    rawHeaderHasExpectedCookie: rawCookieNames.includes(expectedCookieName),
    helperResolvedCookie: Boolean(combinedToken)
  };

  if (!combinedToken) {
    return NextResponse.json({ hasCookie: false, requestCookieState });
  }

  const [invitationToken, flowToken, unexpected] = combinedToken.split(".");
  if (!invitationToken || !flowToken || unexpected) {
    return NextResponse.json({
      hasCookie: true,
      requestCookieState,
      tokenShapeValid: false,
      segmentCount: combinedToken.split(".").length
    });
  }

  const database = await getDatabaseClient();
  const invitationHash = hashOpaqueValue(
    invitationToken,
    environment.authPepper,
    "staff-invitation"
  );
  const flowHash = hashOpaqueValue(
    flowToken,
    environment.authPepper,
    "staff-enrollment"
  );

  const flowResult = await database.query<{
    invitation_id: string;
    current_step: string;
    expires_at: string | Date;
  }>(
    `SELECT invitation_id, current_step, expires_at
     FROM auth_staff_enrollment_flows
     WHERE token_hash = $1`,
    [flowHash]
  );
  const invitationResult = await database.query<{
    invitation_id: string;
    invitation_status: string;
    expires_at: string | Date;
  }>(
    `SELECT invitation_id, invitation_status, expires_at
     FROM auth_staff_invitations
     WHERE token_hash = $1`,
    [invitationHash]
  );

  const flow = flowResult.rows[0] ?? null;
  const invitation = invitationResult.rows[0] ?? null;
  const now = Date.now();
  const flowExpiry = flow ? new Date(flow.expires_at).getTime() : null;
  const invitationExpiry = invitation
    ? new Date(invitation.expires_at).getTime()
    : null;
  const state = await (await getStaffProvisioningService()).readEnrollmentState(
    combinedToken
  );

  return NextResponse.json({
    hasCookie: true,
    requestCookieState,
    tokenShapeValid: true,
    invitationTokenLength: invitationToken.length,
    flowTokenLength: flowToken.length,
    flowExists: Boolean(flow),
    invitationExists: Boolean(invitation),
    invitationIdsMatch:
      Boolean(flow && invitation) && flow?.invitation_id === invitation?.invitation_id,
    flowStep: flow?.current_step ?? null,
    invitationStatus: invitation?.invitation_status ?? null,
    flowExpiryValid:
      flowExpiry === null ? null : Number.isFinite(flowExpiry) && flowExpiry > now,
    invitationExpiryValid:
      invitationExpiry === null
        ? null
        : Number.isFinite(invitationExpiry) && invitationExpiry > now,
    serviceStateResolved: Boolean(state),
    serviceStep: state?.step ?? null,
    serviceRole: state?.role ?? null
  });
}
