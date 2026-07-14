import { NextRequest, NextResponse } from "next/server";
import {
  ensurePhaseZeroOrganization,
  getPurchaseOrderForOrganization,
} from "@rizpoint/database";
import { requirePrivateAccess } from "@/src/private-access";
export const runtime = "nodejs";
export async function GET(
  _: NextRequest,
  { params }: { params: Promise<{ purchaseOrderId: string }> },
) {
  const denied = requirePrivateAccess(_);
  if (denied) return denied;
  const org = await ensurePhaseZeroOrganization();
  const order = await getPurchaseOrderForOrganization(
    org.id,
    (await params).purchaseOrderId,
  );
  return order
    ? NextResponse.json(order)
    : NextResponse.json({ error: "PURCHASE_ORDER_NOT_FOUND" }, { status: 404 });
}
