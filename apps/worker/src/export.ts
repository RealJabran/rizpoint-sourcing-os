import { createHash } from "node:crypto";
import { db } from "@rizpoint/database";
import {
  EXPORT_ENGINE_VERSION,
  toCsv,
  xlsxPayload,
  type ExportTable,
} from "@rizpoint/export-engine";
import { putPrivateObject } from "@rizpoint/object-storage";
import { createXlsxExport } from "./scanner-client.js";

function text(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}
function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}
export function isExportAttemptRunnable(
  status:
    "PENDING" | "RUNNING" | "COMPLETED" | "FAILED_RETRYABLE" | "FAILED_FINAL",
  updatedAt: Date,
  now = new Date(),
): boolean {
  return (
    status === "PENDING" ||
    status === "FAILED_RETRYABLE" ||
    (status === "RUNNING" && updatedAt.getTime() < now.getTime() - 15 * 60_000)
  );
}
export function poSummaryTable(
  order: NonNullable<Awaited<ReturnType<typeof loadOrder>>>,
): ExportTable {
  return {
    sheetName: "PO Summary",
    columns: [
      "PO ID",
      "Supplier",
      "Route",
      "Scenario",
      "Currency",
      "Supplier subtotal",
      "Landed cost total",
      "Revenue total",
      "Amazon fee total",
      "Projected profit total",
    ],
    rows: [
      [
        order.id,
        order.supplier.name,
        order.shippingRoute.name,
        order.scenarioType,
        order.currency,
        text(order.supplierSubtotal),
        text(order.landedCostTotal),
        text(order.projectedRevenueTotal),
        text(order.amazonFeeTotal),
        text(order.projectedProfitTotal),
      ],
    ],
  };
}
export function poTable(
  order: NonNullable<Awaited<ReturnType<typeof loadOrder>>>,
  audit = false,
): ExportTable {
  const columns = audit
    ? [
        "PO ID",
        "Currency",
        "Supplier SKU",
        "ASIN",
        "Title",
        "Scenario",
        "Route",
        "Price provider",
        "Price observed at",
        "Price fresh until",
        "Fee provider",
        "Fee observed at",
        "Fee fresh until",
        "PackGuard",
        "Ordering rules source",
        "Ordering rules observed at",
        "Cost inputs",
        "Formula engine version",
        "Warnings",
        "Requested units",
        "Case pack",
        "MOQ cases",
        "Order multiple",
        "Ordered cases",
        "Ordered units",
        "Projected profit",
        "PO projected profit total",
      ]
    : [
        "PO ID",
        "Supplier",
        "Route",
        "Scenario",
        "Currency",
        "Supplier SKU",
        "ASIN",
        "Title",
        "Requested units",
        "Case pack",
        "MOQ cases",
        "Order multiple",
        "Ordered cases",
        "Ordered units",
        "Unit cost",
        "Supplier total",
        "Landed cost",
        "Projected price",
        "Amazon fees",
        "Projected profit",
        "PO supplier subtotal",
        "PO projected profit total",
      ];
  const rows = order.lines.map((line) => {
    const offer = line.supplierRow.normalizedOffer;
    const product =
      line.supplierRow.matchDecision?.selectedCandidate?.catalogProduct;
    if (audit) {
      const snapshot = record(line.sourceSnapshot);
      const evidence = record(snapshot.evidence);
      const scenario = record(record(evidence.scenarios)[order.scenarioType]);
      const scenarioEvidence = record(scenario.evidence);
      const price = record(scenarioEvidence.price);
      const fee = record(scenarioEvidence.feeQuote);
      const rules = record(snapshot.orderingRules);
      return [
        order.id,
        order.currency,
        text(offer?.itemNumber),
        text(product?.asin ?? offer?.asin),
        text(product?.title ?? offer?.description),
        order.scenarioType,
        order.shippingRoute.name,
        text(price.provider),
        text(price.observedAt),
        text(price.freshUntil),
        text(fee.provider),
        text(fee.observedAt),
        text(fee.freshUntil),
        text(record(evidence.packGuard).status),
        text(rules.source),
        text(rules.observedAt),
        JSON.stringify(record(snapshot.inputSnapshot).costs ?? {}),
        text(snapshot.engineVersion),
        JSON.stringify(line.warnings),
        line.requestedUnits,
        line.casePack,
        line.minimumOrderCases,
        line.orderMultipleCases,
        line.orderedCases,
        line.orderedSellableUnits,
        text(line.projectedProfitTotal),
        text(order.projectedProfitTotal),
      ];
    }
    return [
      order.id,
      order.supplier.name,
      order.shippingRoute.name,
      order.scenarioType,
      order.currency,
      text(offer?.itemNumber),
      text(product?.asin ?? offer?.asin),
      text(product?.title ?? offer?.description),
      line.requestedUnits,
      line.casePack,
      line.minimumOrderCases,
      line.orderMultipleCases,
      line.orderedCases,
      line.orderedSellableUnits,
      text(line.supplierUnitCost),
      text(line.supplierTotal),
      text(line.landedCostTotal),
      text(line.scenarioPrice),
      text(line.amazonFeeTotal),
      text(line.projectedProfitTotal),
      text(order.supplierSubtotal),
      text(order.projectedProfitTotal),
    ];
  });
  return {
    sheetName: audit ? "Audit Report" : "Purchase Order",
    columns,
    rows,
  };
}
async function loadOrder(orderId: string) {
  return db.purchaseOrder.findUnique({
    where: { id: orderId },
    include: {
      shippingRoute: true,
      supplier: true,
      lines: {
        include: {
          supplierRow: {
            include: {
              normalizedOffer: true,
              matchDecision: {
                include: {
                  selectedCandidate: { include: { catalogProduct: true } },
                },
              },
            },
          },
        },
      },
    },
  });
}

async function loadShortlist(shortlistId: string) {
  return db.shortlist.findUnique({
    where: { id: shortlistId },
    include: {
      items: {
        include: {
          profitResult: {
            include: {
              shippingRoute: true,
              supplierRow: {
                include: {
                  normalizedOffer: true,
                  matchDecision: {
                    include: {
                      selectedCandidate: { include: { catalogProduct: true } },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });
}

function shortlistTable(
  shortlist: NonNullable<Awaited<ReturnType<typeof loadShortlist>>>,
): ExportTable {
  return {
    sheetName: "Shortlist",
    columns: [
      "Status",
      "Owner",
      "Supplier SKU",
      "ASIN",
      "Title",
      "Route",
      "Recommendation",
      "Current net profit",
      "Conservative net profit",
      "Updated at",
    ],
    rows: shortlist.items.map((item) => {
      const row = item.profitResult.supplierRow;
      const offer = row.normalizedOffer;
      const product = row.matchDecision?.selectedCandidate?.catalogProduct;
      return [
        item.status,
        text(item.ownerReference),
        text(offer?.itemNumber),
        text(product?.asin ?? offer?.asin),
        text(product?.title ?? offer?.description),
        item.profitResult.shippingRoute.name,
        text(item.profitResult.recommendation),
        text(item.profitResult.currentNetProfit),
        text(item.profitResult.conservativeNetProfit),
        item.updatedAt.toISOString(),
      ];
    }),
  };
}

export async function processExport(exportJobId: string): Promise<void> {
  const job = await db.exportJob.findUnique({ where: { id: exportJobId } });
  if (!job || job.status === "COMPLETED" || job.status === "FAILED_FINAL")
    return;
  const now = new Date();
  const claimed = await db.exportJob.updateMany({
    where: {
      id: job.id,
      OR: [
        { status: { in: ["PENDING", "FAILED_RETRYABLE"] } },
        {
          status: "RUNNING",
          updatedAt: { lt: new Date(now.getTime() - 15 * 60_000) },
        },
      ],
    },
    data: {
      status: "RUNNING",
      attemptCount: { increment: 1 },
      failureCode: null,
    },
  });
  if (!claimed.count) return;
  try {
    const source = job.purchaseOrderId
      ? await loadOrder(job.purchaseOrderId)
      : job.shortlistId
        ? await loadShortlist(job.shortlistId)
        : null;
    if (!source || source.organizationId !== job.organizationId)
      throw new Error("EXPORT_SOURCE_NOT_FOUND");
    if (source.revision !== job.sourceRevision)
      throw new Error("EXPORT_SOURCE_STALE");
    const isOrder = "lines" in source;
    if (
      isOrder &&
      source.status !== "VALIDATED" &&
      source.status !== "EXPORTED"
    )
      throw new Error("PURCHASE_ORDER_NOT_VALIDATED");
    const table = isOrder
      ? poTable(source, job.kind === "AUDIT_REPORT")
      : shortlistTable(source);
    const tables =
      isOrder && job.kind === "PURCHASE_ORDER"
        ? [poSummaryTable(source), table, poTable(source, true)]
        : [table];
    const bytes =
      job.format === "CSV"
        ? toCsv(table)
        : await createXlsxExport(xlsxPayload(tables));
    const checksumSha256 = createHash("sha256").update(bytes).digest("hex");
    const extension = job.format.toLowerCase();
    const filename = `rizpoint-${job.kind.toLowerCase()}-${source.id}.${extension}`;
    const objectKey = `exports/${job.organizationId}/${job.id}/${checksumSha256}.${extension}`;
    const contentType =
      job.format === "CSV"
        ? "text/csv; charset=utf-8"
        : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    await putPrivateObject({
      objectKey,
      body: bytes,
      contentType,
      contentDisposition: `attachment; filename="${filename}"`,
    });
    await db.$transaction(async (transaction) => {
      await transaction.exportJob.update({
        where: { id: job.id },
        data: {
          status: "COMPLETED",
          objectKey,
          filename,
          contentType,
          checksumSha256,
          byteSize: bytes.byteLength,
          generatorVersion: EXPORT_ENGINE_VERSION,
          completedAt: now,
          expiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60_000),
        },
      });
      if (isOrder && job.kind === "PURCHASE_ORDER")
        await transaction.purchaseOrder.update({
          where: { id: source.id },
          data: { status: "EXPORTED" },
        });
      await transaction.workflowAuditEvent.create({
        data: {
          organizationId: job.organizationId,
          entityType: "EXPORT",
          entityId: job.id,
          eventType: "COMPLETED",
          payload: { checksumSha256, byteSize: bytes.byteLength },
        },
      });
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : "EXPORT_FAILED";
    await db.exportJob.update({
      where: { id: exportJobId },
      data: {
        status: job.attemptCount + 1 >= 3 ? "FAILED_FINAL" : "FAILED_RETRYABLE",
        failureCode: code,
      },
    });
    throw error;
  }
}
