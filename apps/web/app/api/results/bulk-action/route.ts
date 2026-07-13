import { NextRequest, NextResponse } from "next/server";
import {
  applyAnalysisOverride,
  ensurePhaseZeroOrganization,
  getAnalysisOverrideForResult,
  queueAnalysisRecalculation,
} from "@rizpoint/database";
import { phaseZeroDemoEnabled } from "@/src/phase-zero";
import { bulkActionSchema } from "@/src/analysis/contracts";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!phaseZeroDemoEnabled())
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = await request.json().catch(() => null);
  const parsed = bulkActionSchema.safeParse(body);
  if (!parsed.success)
    return NextResponse.json({ error: "INVALID_BULK_ACTION" }, { status: 400 });
  if (
    parsed.data.action === "APPLY_COST_OVERRIDE" &&
    !parsed.data.values?.length &&
    parsed.data.stressDiscountPercent === undefined
  )
    return NextResponse.json(
      { error: "BULK_OVERRIDE_VALUES_REQUIRED" },
      { status: 400 },
    );
  const organization = await ensurePhaseZeroOrganization();
  const outcomes: Array<{ resultId: string; status: string }> = [];
  for (const resultId of parsed.data.resultIds) {
    const idempotencyKey = `${parsed.data.idempotencyKey}:${resultId}`;
    try {
      if (parsed.data.action === "RECALCULATE") {
        const output = await queueAnalysisRecalculation({
          organizationId: organization.id,
          resultId,
          idempotencyKey,
        });
        outcomes.push({
          resultId,
          status: output
            ? output.duplicate
              ? "DUPLICATE"
              : "QUEUED"
            : "NOT_FOUND",
        });
        continue;
      }
      const result = await getAnalysisOverrideForResult(
        organization.id,
        resultId,
      );
      if (!result) {
        outcomes.push({ resultId, status: "NOT_FOUND" });
        continue;
      }
      const override = result.supplierRow.profitCostOverrides.find(
        (candidate) => candidate.shippingRouteId === result.shippingRouteId,
      );
      if (parsed.data.action === "CLEAR_COST_OVERRIDE" && !override) {
        outcomes.push({ resultId, status: "SKIPPED_NO_OVERRIDE" });
        continue;
      }
      const output = await applyAnalysisOverride({
        organizationId: organization.id,
        resultId,
        expectedRevision: override?.revision ?? 0,
        idempotencyKey,
        reason: parsed.data.reason ?? "Bulk cost override",
        values:
          parsed.data.action === "CLEAR_COST_OVERRIDE"
            ? (override?.values.map((value) => ({
                field: value.field,
                value: null,
              })) ?? [])
            : (parsed.data.values ?? []),
        stressDiscountPercent:
          parsed.data.action === "CLEAR_COST_OVERRIDE"
            ? null
            : parsed.data.stressDiscountPercent,
      });
      outcomes.push({
        resultId,
        status: output
          ? output.duplicate
            ? "DUPLICATE"
            : "QUEUED"
          : "NOT_FOUND",
      });
    } catch (error) {
      outcomes.push({
        resultId,
        status:
          error instanceof Error &&
          error.message === "OVERRIDE_REVISION_CONFLICT"
            ? "CONFLICT"
            : "FAILED",
      });
    }
  }
  return NextResponse.json({ outcomes }, { status: 202 });
}
