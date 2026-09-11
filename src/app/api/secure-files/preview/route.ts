import { SecureFileAccessDeniedError } from "@/lib/secure-files/secure-file-access-domain";
import {
  readCurrentSecureFilePrincipal,
  readSingleAccessToken,
  secureFileAccessDeniedResponse,
  secureFileAccessErrorResponse
} from "@/lib/secure-files/secure-file-access-http";
import { readSecureFileAccess } from "@/lib/secure-files/secure-file-access-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    const principal = await readCurrentSecureFilePrincipal();
    const token = readSingleAccessToken(request);
    const content = await readSecureFileAccess({
      principal,
      token,
      expectedPurpose: "preview"
    });
    return new Response(Buffer.from(content.bytes), {
      status: 200,
      headers: content.headers
    });
  } catch (error) {
    if (error instanceof SecureFileAccessDeniedError) {
      return secureFileAccessDeniedResponse();
    }
    return secureFileAccessErrorResponse();
  }
}
