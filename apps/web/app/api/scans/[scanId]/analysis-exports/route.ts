import { NextRequest, NextResponse } from "next/server";
import { ensurePhaseZeroOrganization, queueExport } from "@rizpoint/database";
import { analysisExportSchema } from "@/src/analysis/contracts";
import { phaseZeroDemoEnabled } from "@/src/phase-zero";

export const runtime = "nodejs";

/** Queues a private, formula-safe snapshot of the current server-side view. */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ scanId: string }> },
) {
  if (!phaseZeroDemoEnabled())
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  const parsed = analysisExportSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success)
    return NextResponse.json(
      { error: "INVALID_ANALYSIS_EXPORT_REQUEST" },
      { status: 400 },
    );
  const organization = await ensurePhaseZeroOrganization();
  try {
    const job = await queueExport({
      organizationId: organization.id,
      kind: "ANALYSIS_VIEW",
      format: parsed.data.format,
      scanJobId: (await params).scanId,
      // JSON round-trip removes optional undefined values before the JSON column.
      queryState: JSON.parse(JSON.stringify(parsed.data.queryState)),
      idempotencyKey: parsed.data.idempotencyKey,
    });
    return NextResponse.json(
      { id: job.id, status: job.status, format: job.format },
      { status: 202 },
    );
  } catch (error) {
    const code = error instanceof Error ? error.message : "ANALYSIS_EXPORT_FAILED";
    if (code === "ANALYSIS_EXPORT_SCAN_NOT_FOUND")
      return NextResponse.json({ error: "SCAN_NOT_FOUND" }, { status: 404 });
    return NextResponse.json({ error: "ANALYSIS_EXPORT_UNAVAILABLE" }, { status: 409 });
  }
}
