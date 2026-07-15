import { NextRequest, NextResponse } from "next/server";
import {
  ensurePhaseZeroOrganization,
  listScanSummaries,
} from "@rizpoint/database";
import { phaseZeroDemoEnabled } from "@/src/phase-zero";
import { toScanSummary } from "../../../src/scan-summary";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  if (!phaseZeroDemoEnabled())
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  const requestedLimit = Number.parseInt(
    request.nextUrl.searchParams.get("limit") ?? "25",
    10,
  );
  if (!Number.isInteger(requestedLimit) || requestedLimit < 1)
    return NextResponse.json({ error: "INVALID_SCAN_LIMIT" }, { status: 400 });
  const organization = await ensurePhaseZeroOrganization();
  return NextResponse.json(
    (
      await listScanSummaries(organization.id, Math.min(requestedLimit, 50))
    ).map(toScanSummary),
  );
}
