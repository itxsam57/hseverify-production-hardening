import { NextResponse } from "next/server";
import { ScopedShareLinkService } from "@/lib/share-links/scoped-share-link-service";
import { requireWorkerSession } from "@/lib/auth/worker-session";

export async function POST(request: Request) {
  const session = await requireWorkerSession();
  const contentType = request.headers.get("content-type") ?? "";
  const body = contentType.includes("application/json")
    ? await request.json() as {
      fields?: string[];
      purpose?: string;
      employerDetail?: string;
      createdAt?: string;
      expiresAt?: string | null;
    }
    : Object.fromEntries(await request.formData()) as unknown as {
    fields?: string[];
    purpose?: string;
    employerDetail?: string;
    createdAt?: string;
    expiresAt?: string | null;
  };

  const rawFields = body.fields as unknown;
  const fields = Array.isArray(rawFields)
    ? rawFields.map((field) => String(field))
    : typeof rawFields === "string"
      ? rawFields.split(",").map((field: string) => field.trim())
      : undefined;

  if (!fields || !body.purpose || !body.createdAt) {
    return NextResponse.json({ error: "invalid_share_link_request" }, { status: 400 });
  }

  const result = await new ScopedShareLinkService().create({
    ownerWorkerId: session.workerId,
    fields: fields as never,
    purpose: body.purpose,
    employerDetail: body.employerDetail,
    createdAt: body.createdAt,
    expiresAt: body.expiresAt
  });

  return NextResponse.json(result, { status: 201 });
}

export async function GET() {
  const session = await requireWorkerSession();
  const links = await new ScopedShareLinkService().listOwned(session.workerId);
  return NextResponse.json({ links });
}

export async function DELETE(request: Request) {
  const session = await requireWorkerSession();
  const body = await request.json() as {
    shareLinkId?: string;
    revokedAt?: string;
  };

  if (!body.shareLinkId || !body.revokedAt) {
    return NextResponse.json({ error: "invalid_share_link_request" }, { status: 400 });
  }

  const result = await new ScopedShareLinkService().revoke({
    ownerWorkerId: session.workerId,
    shareLinkId: body.shareLinkId,
    revokedAt: body.revokedAt
  });

  return NextResponse.json(result);
}
