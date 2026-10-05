import { NextResponse } from "next/server";
import { ScopedShareLinkService } from "@/lib/share-links/scoped-share-link-service";
import { ScopedShareLinkRepository } from "@/lib/share-links/scoped-share-link-repository";
import { requirePortalAuthorization } from "@/lib/authorization/authorization-service";
import { getDatabaseClient } from "@/lib/database/database";
import { ConsentRecordService } from "@/lib/privacy/consent-record-service";
import { requireWorkerSession } from "@/lib/auth/worker-session";

export async function POST(request: Request) {
  const principal = await requirePortalAuthorization("worker");
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

  const purpose = body.purpose;
  const createdAt = new Date().toISOString();
  if (!fields || !purpose) {
    return NextResponse.json({ error: "invalid_share_link_request" }, { status: 400 });
  }

  const database = await getDatabaseClient();
  const result = await database.transaction(async (tx) => {
    const created = await new ScopedShareLinkService(
      new ScopedShareLinkRepository(Promise.resolve(tx))
    ).create({
      ownerWorkerId: session.workerId,
      fields: fields as never,
      purpose,
      employerDetail: body.employerDetail,
      createdAt,
      expiresAt: body.expiresAt
    });
    await new ConsentRecordService(Promise.resolve(tx)).grant({
      workerId: principal.accountId,
      actorAccountId: principal.accountId,
      consentType: "scoped_share_links",
      purpose: "Create the requested scoped share link containing only the Worker-selected passport fields.",
      withdrawalRule: "FUTURE_PROCESSING_ONLY",
      metadata: {
        shareLinkId: created.record.shareLinkId,
        fields: fields.join(","),
        sharePurpose: purpose
      }
    });
    return created;
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
  };

  if (!body.shareLinkId) {
    return NextResponse.json({ error: "invalid_share_link_request" }, { status: 400 });
  }

  const result = await new ScopedShareLinkService().revoke({
    ownerWorkerId: session.workerId,
    shareLinkId: body.shareLinkId,
    revokedAt: new Date().toISOString()
  });

  return NextResponse.json(result);
}
