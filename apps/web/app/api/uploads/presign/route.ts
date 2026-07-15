import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createUpload, ensurePhaseZeroOrganization } from "@rizpoint/database";
import { createUploadUrl } from "@rizpoint/object-storage";
import { phaseZeroDemoEnabled } from "@/src/phase-zero";
import {
  presignInputSchema,
  validateDeclaredMediaType,
  validateFilename,
} from "@/src/phase-one";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!phaseZeroDemoEnabled())
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  const parsed = presignInputSchema.safeParse(await request.json());
  if (!parsed.success)
    return NextResponse.json({ error: "INVALID_UPLOAD" }, { status: 400 });
  try {
    validateFilename(parsed.data.filename);
    validateDeclaredMediaType(parsed.data.filename, parsed.data.contentType);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "INVALID_UPLOAD" },
      { status: 400 },
    );
  }
  const organization = await ensurePhaseZeroOrganization();
  const idempotencyKey = request.headers.get("idempotency-key") ?? randomUUID();
  const created = await createUpload(
    organization.id,
    parsed.data.supplierId,
    parsed.data.filename,
    parsed.data.contentType,
    idempotencyKey,
  );
  if (!created)
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  const uploadUrl = await createUploadUrl(
    created.upload.objectKey,
    parsed.data.contentType,
  );
  return NextResponse.json({
    uploadId: created.upload.id,
    scanId: created.scan.id,
    uploadUrl,
    expiresInSeconds: 300,
  });
}
