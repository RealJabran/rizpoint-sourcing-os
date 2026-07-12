import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  ensurePhaseZeroOrganization,
  getUploadForOrganization,
  queueUploadInspection,
} from "@rizpoint/database";
import { getObjectBytes, getObjectMetadata } from "@rizpoint/object-storage";
import { phaseZeroDemoEnabled } from "@/src/phase-zero";
import { validateUploadedObjectMetadata } from "@/src/phase-one";

export const runtime = "nodejs";

export async function POST(
  _: NextRequest,
  { params }: { params: Promise<{ uploadId: string }> },
) {
  if (!phaseZeroDemoEnabled())
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  const organization = await ensurePhaseZeroOrganization();
  const upload = await getUploadForOrganization(
    organization.id,
    (await params).uploadId,
  );
  if (!upload)
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    const metadata = await getObjectMetadata(upload.objectKey);
    validateUploadedObjectMetadata(
      metadata.ContentLength,
      metadata.ContentType,
      upload.declaredMediaType,
    );
    const bytes = await getObjectBytes(upload.objectKey);
    const scan = await queueUploadInspection(
      organization.id,
      upload.id,
      bytes.byteLength,
      createHash("sha256").update(bytes).digest("hex"),
    );
    return scan
      ? NextResponse.json(scan, { status: 202 })
      : NextResponse.json({ error: "Not found" }, { status: 404 });
  } catch (error) {
    const code =
      error instanceof Error ? error.message : "UPLOAD_OBJECT_MISSING";
    const status =
      code === "FILE_SIZE_LIMIT"
        ? 413
        : code === "CONTENT_TYPE_MISMATCH"
          ? 400
          : 409;
    return NextResponse.json({ error: code }, { status });
  }
}
