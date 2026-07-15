import { NextRequest, NextResponse } from "next/server";
import {
  createPurchaseOrder,
  ensurePhaseZeroOrganization,
  getSupplierForOrganization,
  getShortlistItemsForPurchaseOrder,
  listPurchaseOrdersForOrganization,
} from "@rizpoint/database";
import { requirePrivateAccess } from "@/src/private-access";
import { createPurchaseOrderSchema } from "@/src/phase-six/contracts";
import { makeOrder, sumOrderLines } from "@/src/phase-six/order-input";

export async function GET(request: NextRequest) {
  const denied = requirePrivateAccess(request);
  if (denied) return denied;
  const organization = await ensurePhaseZeroOrganization();
  return NextResponse.json(
    await listPurchaseOrdersForOrganization(organization.id),
  );
}

export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  const denied = requirePrivateAccess(request);
  if (denied) return denied;
  const parsed = createPurchaseOrderSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success)
    return NextResponse.json(
      { error: "INVALID_PURCHASE_ORDER" },
      { status: 400 },
    );
  try {
    const org = await ensurePhaseZeroOrganization();
    const data = parsed.data;
    const items = await getShortlistItemsForPurchaseOrder(
      org.id,
      data.shortlistId,
      data.itemIds,
    );
    if (items.length !== new Set(data.itemIds).size)
      return NextResponse.json(
        { error: "SHORTLIST_ITEM_NOT_FOUND" },
        { status: 404 },
      );
    const first = items[0]?.profitResult;
    if (!first?.supplierRow.scanJob.supplierId)
      throw new Error("SUPPLIER_REQUIRED");
    if (
      items.some(
        (item) =>
          item.profitResult.supplierRow.scanJob.supplierId !==
            first.supplierRow.scanJob.supplierId ||
          item.profitResult.shippingRouteId !== first.shippingRouteId,
      )
    )
      throw new Error("MIXED_SUPPLIER_OR_ROUTE");
    const supplier = await getSupplierForOrganization(
      org.id,
      first.supplierRow.scanJob.supplierId,
    );
    if (
      !supplier ||
      !supplier.orderingRulesSource ||
      !supplier.orderingRulesObservedAt
    )
      throw new Error("SUPPLIER_ORDERING_RULES_REQUIRED");
    const orderingRulesObservedAt = supplier.orderingRulesObservedAt;
    const prepared = items.map((item) => {
      const quantity = data.quantities[item.id];
      if (!quantity) throw new Error("QUANTITY_REQUIRED");
      const line = makeOrder({
        result: item.profitResult,
        scenarioType: data.scenarioType,
        requestedUnits: quantity.requestedUnits,
        minimumOrderCases: supplier.minimumOrderCases,
        orderMultipleCases: supplier.orderMultipleCases,
      });
      return {
        shortlistItemId: item.id,
        supplierRowId: item.profitResult.supplierRowId,
        profitResultId: item.profitResult.id,
        requestedUnits: line.requestedUnits,
        casePack: line.casePack,
        minimumOrderCases: line.minimumOrderCases,
        orderMultipleCases: line.orderMultipleCases,
        orderedCases: line.orderedCases,
        orderedSellableUnits: line.orderedSellableUnits,
        supplierUnitCost: line.scenario.supplierUnitCost,
        scenarioPrice: line.scenario.price,
        scenarioEffectiveCogs: line.scenario.effectiveCogs,
        scenarioAmazonFee: line.scenario.amazonFees,
        scenarioNetProfit: line.scenario.netProfit,
        supplierTotal: line.supplierTotal,
        landedCostTotal: line.landedCostTotal,
        projectedRevenueTotal: line.projectedRevenueTotal,
        amazonFeeTotal: line.amazonFeeTotal,
        projectedProfitTotal: line.projectedProfitTotal,
        sourceSnapshot: {
          engineVersion: item.profitResult.engineVersion,
          evidence: item.profitResult.evidence,
          inputSnapshot: item.profitResult.inputSnapshot,
          scenarioType: data.scenarioType,
          currency: first.shippingRoute.currency,
          orderingRules: {
            source: supplier.orderingRulesSource,
            observedAt: orderingRulesObservedAt.toISOString(),
            minimumOrderCases: supplier.minimumOrderCases,
            orderMultipleCases: supplier.orderMultipleCases,
            minimumOrderAmount: supplier.minimumOrderAmount?.toString() ?? null,
          },
        },
        warnings: [...line.warnings],
      };
    });
    const totals = sumOrderLines(prepared);
    const order = await createPurchaseOrder({
      organizationId: org.id,
      supplierId: first.supplierRow.scanJob.supplierId,
      shortlistId: data.shortlistId,
      shippingRouteId: first.shippingRouteId,
      scenarioType: data.scenarioType,
      currency: first.shippingRoute.currency,
      idempotencyKey: data.idempotencyKey,
      ...(data.budgetAmount !== undefined
        ? { budgetAmount: data.budgetAmount }
        : {}),
      ...(supplier.minimumOrderAmount !== null
        ? { minimumOrderAmount: supplier.minimumOrderAmount.toString() }
        : {}),
      lines: prepared,
      totals,
    });
    return NextResponse.json(order, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "PURCHASE_ORDER_FAILED",
      },
      { status: 422 },
    );
  }
}
