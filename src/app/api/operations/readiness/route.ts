import { createHash, timingSafeEqual } from "node:crypto";
import { getDatabaseClient } from "@/lib/database/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEADERS = {
  "Cache-Control": "no-store, no-cache, max-age=0",
  "Pragma": "no-cache",
  "Vary": "Authorization",
  "Content-Type": "application/json"
};

function sameSecret(candidate: string, expected: string): boolean {
  const left = createHash("sha256").update(candidate).digest();
  const right = createHash("sha256").update(expected).digest();
  return timingSafeEqual(left, right);
}

export async function GET(request: Request): Promise<Response> {
  const expectedToken = process.env.HSE_MONITOR_PROBE_TOKEN;
  const releaseSha = process.env.HSE_RELEASE_SHA;
  if (!expectedToken || expectedToken.length < 32 || !releaseSha || !/^[a-f0-9]{40}$/.test(releaseSha)) {
    return new Response(JSON.stringify({ status: "unavailable" }), { status: 503, headers: HEADERS });
  }
  if (!sameSecret(request.headers.get("authorization") ?? "", "Bearer " + expectedToken)) {
    return new Response(JSON.stringify({ status: "unauthorized" }), {
      status: 401, headers: { ...HEADERS, "WWW-Authenticate": 'Bearer realm="HSE readiness"' }
    });
  }
  try {
    const database = await getDatabaseClient();
    const result = await database.query<{ ok: number }>("SELECT 1::integer AS ok");
    if (result.rows.length !== 1 || Number(result.rows[0]?.ok) !== 1) {
      throw new Error("Readiness database query returned an invalid result");
    }
    return new Response(JSON.stringify({ status: "ready", scope: "database_connection_only", releaseSha }), { status: 200, headers: HEADERS });
  } catch {
    return new Response(JSON.stringify({ status: "unavailable" }), { status: 503, headers: HEADERS });
  }
}
