import { NextRequest, NextResponse } from "next/server";
import {
  ensurePhaseZeroOrganization,
  validatePurchaseOrder,
} from "@rizpoint/database";
import { requirePrivateAccess } from "@/src/private-access";
import { validatePurchaseOrderSchema } from "@/src/phase-six/contracts";
export const runtime = "nodejs";
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ purchaseOrderId: string }> },
) {
  const denied = requirePrivateAccess(request);
  if (denied) return denied;
  const parsed = validatePurchaseOrderSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success)
    return NextResponse.json(
      { error: "INVALID_PURCHASE_ORDER_VALIDATION" },
      { status: 400 },
    );
  try {
    const org = await ensurePhaseZeroOrganization();
    const order = await validatePurchaseOrder(
      org.id,
      (await params).purchaseOrderId,
      parsed.data.expectedRevision,
      parsed.data.idempotencyKey,
    );
    return order
      ? NextResponse.json(order)
      : NextResponse.json(
          { error: "PURCHASE_ORDER_NOT_FOUND" },
          { status: 404 },
        );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "PURCHASE_ORDER_VALIDATION_FAILED",
      },
      { status: 409 },
    );
  }
}
