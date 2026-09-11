import "server-only";

import type { AuthorizationPrincipal } from "../authorization/authorization-context-domain";
import { readServerAuthorizationContext } from "../authorization/authorization-service";
import {
  SecureFileAccessDeniedError,
  type SecureFileAccessPurpose
} from "./secure-file-access-domain";

const NO_STORE_HEADERS = Object.freeze({
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff"
});

export async function readCurrentSecureFilePrincipal(): Promise<AuthorizationPrincipal> {
  const resolution = await readServerAuthorizationContext();
  if (!resolution.allowed) {
    throw new SecureFileAccessDeniedError();
  }
  return resolution.principal;
}

export function buildSignedSecureFileAccessUrl(input: {
  purpose: SecureFileAccessPurpose;
  token: string;
}): string {
  const path = input.purpose === "preview"
    ? "/api/secure-files/preview"
    : "/api/secure-files/download";
  return `${path}?access=${encodeURIComponent(input.token)}`;
}

export function readSingleAccessToken(request: Request): string {
  const url = new URL(request.url);
  const keys = Array.from(url.searchParams.keys());
  const values = url.searchParams.getAll("access");
  if (
    keys.length !== 1 ||
    keys[0] !== "access" ||
    values.length !== 1 ||
    values[0].length < 32 ||
    values[0].length > 2_048
  ) {
    throw new SecureFileAccessDeniedError();
  }
  return values[0];
}

export function secureFileAccessDeniedResponse(): Response {
  return new Response(null, {
    status: 404,
    headers: NO_STORE_HEADERS
  });
}

export function secureFileAccessBadRequestResponse(): Response {
  return new Response(null, {
    status: 400,
    headers: NO_STORE_HEADERS
  });
}

export function secureFileAccessErrorResponse(): Response {
  return new Response(null, {
    status: 500,
    headers: NO_STORE_HEADERS
  });
}

export function secureFileAuthorizationResponse(input: {
  accessUrl: string;
  expiresAt: string;
}): Response {
  return Response.json(
    Object.freeze({
      accessUrl: input.accessUrl,
      expiresAt: input.expiresAt
    }),
    {
      status: 200,
      headers: NO_STORE_HEADERS
    }
  );
}
