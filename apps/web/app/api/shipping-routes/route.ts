import { NextRequest, NextResponse } from "next/server";
import {
  ensurePhaseZeroOrganization,
  saveShippingRoute,
} from "@rizpoint/database";
import { phaseZeroDemoEnabled } from "@/src/phase-zero";
import { shippingRouteSchema } from "@/src/phase-four";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!phaseZeroDemoEnabled())
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  const parsed = shippingRouteSchema.safeParse(await request.json());
  if (!parsed.success)
    return NextResponse.json(
      { error: "INVALID_SHIPPING_ROUTE" },
      { status: 400 },
    );
  if (
    parsed.data.effectiveTo &&
    parsed.data.effectiveTo < parsed.data.effectiveFrom
  ) {
    return NextResponse.json(
      { error: "INVALID_ROUTE_EFFECTIVITY" },
      { status: 400 },
    );
  }
  const organization = await ensurePhaseZeroOrganization();
  const route = await saveShippingRoute({
    organizationId: organization.id,
    name: parsed.data.name,
    currency: parsed.data.currency,
    effectiveFrom: new Date(parsed.data.effectiveFrom),
    ...(parsed.data.effectiveTo
      ? { effectiveTo: new Date(parsed.data.effectiveTo) }
      : {}),
    ...(parsed.data.active !== undefined ? { active: parsed.data.active } : {}),
    allocatedSupplierFreight: parsed.data.allocatedSupplierFreight,
    prepFee: parsed.data.prepFee,
    labelingFee: parsed.data.labelingFee,
    polybagFee: parsed.data.polybagFee,
    bundleFee: parsed.data.bundleFee,
    bubblewrapFee: parsed.data.bubblewrapFee,
    inboundShipping: parsed.data.inboundShipping,
    dutyOrTax: parsed.data.dutyOrTax,
    storageAllowance: parsed.data.storageAllowance,
    returnAllowance: parsed.data.returnAllowance,
    otherCosts: parsed.data.otherCosts,
  });
  return NextResponse.json(route, { status: 201 });
}
