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
function poTable(
  order: NonNullable<Awaited<ReturnType<typeof loadOrder>>>,
  audit = false,
): ExportTable {
  const columns = audit
    ? [
        "Supplier SKU",
        "ASIN",
        "Title",
        "Scenario",
        "Route",
        "Provider evidence",
        "Observed at",
        "Fresh until",
        "PackGuard",
        "Requested units",
        "Case pack",
        "MOQ cases",
        "Order multiple",
        "Ordered cases",
        "Ordered units",
        "Projected profit",
      ]
    : [
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
      ];
  const rows = order.lines.map((line) => {
    const offer = line.supplierRow.normalizedOffer;
    const product =
      line.supplierRow.matchDecision?.selectedCandidate?.catalogProduct;
    if (audit) {
      const snapshot = line.sourceSnapshot as {
        evidence?: {
          current?: {
            provider?: string;
            observedAt?: string;
            freshUntil?: string;
          };
          packGuard?: { status?: string };
        };
      };
      return [
        text(offer?.itemNumber),
        text(product?.asin ?? offer?.asin),
        text(product?.title ?? offer?.description),
        order.scenarioType,
        order.shippingRoute.name,
        text(snapshot.evidence?.current?.provider),
        text(snapshot.evidence?.current?.observedAt),
        text(snapshot.evidence?.current?.freshUntil),
        text(snapshot.evidence?.packGuard?.status),
        line.requestedUnits,
        line.casePack,
        line.minimumOrderCases,
        line.orderMultipleCases,
        line.orderedCases,
        line.orderedSellableUnits,
        text(line.projectedProfitTotal),
      ];
    }
    return [
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
  const claimed = await db.exportJob.updateMany({
    where: { id: job.id, status: { in: ["PENDING", "FAILED_RETRYABLE"] } },
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
        ? [table, poTable(source, true)]
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
          completedAt: new Date(),
        },
      });
      if (isOrder)
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
