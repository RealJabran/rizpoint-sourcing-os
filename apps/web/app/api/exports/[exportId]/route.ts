import { NextRequest, NextResponse } from "next/server";
import {
  ensurePhaseZeroOrganization,
  getExportForOrganization,
} from "@rizpoint/database";
import { createDownloadUrl } from "@rizpoint/object-storage";
import { requirePrivateAccess } from "@/src/private-access";
import { exportDownloadState } from "@/src/phase-six/export-download";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ exportId: string }> },
) {
  const denied = requirePrivateAccess(request);
  if (denied) return denied;
  const org = await ensurePhaseZeroOrganization();
  const job = await getExportForOrganization(org.id, (await params).exportId);
  if (!job)
    return NextResponse.json({ error: "EXPORT_NOT_FOUND" }, { status: 404 });
  const downloadState = exportDownloadState(job);
  if (
    request.nextUrl.searchParams.get("download") === "1" &&
    downloadState === "EXPIRED"
  )
    return NextResponse.json({ error: "EXPORT_EXPIRED" }, { status: 410 });
  if (
    request.nextUrl.searchParams.get("download") === "1" &&
    downloadState === "READY"
  )
    return NextResponse.redirect(
      await createDownloadUrl(job.objectKey!, job.filename!),
    );
  return NextResponse.json({
    id: job.id,
    kind: job.kind,
    format: job.format,
    status: job.status,
    filename: job.filename,
    contentType: job.contentType,
    checksumSha256: job.checksumSha256,
    byteSize: job.byteSize,
    failureCode: job.failureCode,
    completedAt: job.completedAt,
    expiresAt: job.expiresAt,
    downloadState,
  });
}
