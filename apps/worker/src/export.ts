import { createHash } from "node:crypto";
import {
  db,
  listAnalysisResults,
  resolveProviderExportRights,
  type AnalysisFilters,
  type AnalysisSort,
  type ProviderExportFieldRequest,
} from "@rizpoint/database";
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
function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

export function providerEntitlementKey(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  if (value === "AMAZON_SP_API") return "amazon-sp-api";
  if (value === "MOCK_AMAZON") return "mock-amazon";
  // MockCatalogProvider is the catalog surface of the credential-free
  // mock-amazon connection and therefore shares its synthetic fixture rights.
  if (value === "mock-catalog") return "mock-amazon";
  if (value === "MOCK_HISTORY") return "recorded-history";
  return value;
}

function addRightsRequest(
  requests: Map<string, ProviderExportFieldRequest>,
  input: {
    provider: unknown;
    marketplaceId: unknown;
    capability: ProviderExportFieldRequest["capability"];
    fields: readonly string[];
  },
) {
  const provider = providerEntitlementKey(input.provider);
  if (!provider) return;
  if (typeof input.marketplaceId !== "string" || !input.marketplaceId)
    throw new Error("PROVIDER_EXPORT_MARKETPLACE_MISSING");
  const key = `${provider}\u0000${input.marketplaceId}\u0000${input.capability}`;
  const previous = requests.get(key);
  requests.set(key, {
    providerKey: provider,
    marketplaceId: input.marketplaceId,
    capability: input.capability,
    fields: [...new Set([...(previous?.fields ?? []), ...input.fields])],
  });
}

async function assertProviderExportRights(
  organizationId: string,
  requests: Map<string, ProviderExportFieldRequest>,
) {
  if (!requests.size) return;
  const decisions = await resolveProviderExportRights({
    organizationId,
    requests: [...requests.values()],
  });
  if (decisions.some((decision) => decision.deniedFields.length > 0))
    throw new Error("PROVIDER_EXPORT_RIGHTS_BLOCKED");
}

function financialExportRightsRequests(
  sources: readonly {
    catalogProvider: unknown;
    marketplaceId: unknown;
    evidence: unknown;
    scenarioType: string;
  }[],
) {
  const requests = new Map<string, ProviderExportFieldRequest>();
  for (const source of sources) {
    addRightsRequest(requests, {
      provider: source.catalogProvider,
      marketplaceId: source.marketplaceId,
      capability: "CATALOG",
      fields: ["catalog.identity"],
    });
    const scenario = record(record(source.evidence).scenarios)[
      source.scenarioType
    ];
    const scenarioEvidence = record(record(scenario).evidence);
    addRightsRequest(requests, {
      provider: record(scenarioEvidence.price).provider,
      marketplaceId: source.marketplaceId,
      capability: "COMPETITIVE_OFFERS",
      fields: ["pricing.exportedFinancialInputs"],
    });
    addRightsRequest(requests, {
      provider: record(scenarioEvidence.feeQuote).provider,
      marketplaceId: source.marketplaceId,
      capability: "FEES",
      fields: ["fees.exportedFinancialInputs"],
    });
  }
  return requests;
}

// The web API intentionally caps interactive windows at 200 rows. Export is a
// worker-only, tenant-scoped operation, so it can use a larger bounded page to
// avoid repeating the same filter/count/context work hundreds of times for a
// 50,000-row active view.
export const ANALYSIS_EXPORT_PAGE_SIZE = 5_000;
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

/** Reconstruct only validated, persisted active-view filters for export. */
export function analysisFiltersFromViewState(
  queryState: unknown,
): AnalysisFilters {
  const query = record(queryState);
  const textValue = (key: string) =>
    typeof query[key] === "string" ? query[key] : undefined;
  const numberValue = (key: string) =>
    typeof query[key] === "number" ? query[key] : undefined;
  return {
    recommendation: textValue(
      "recommendation",
    ) as AnalysisFilters["recommendation"],
    status: textValue("status") as AnalysisFilters["status"],
    search: textValue("search"),
    minRoiPercent: textValue("minRoiPercent"),
    maxRoiPercent: textValue("maxRoiPercent"),
    minNetProfit: textValue("minNetProfit"),
    maxNetProfit: textValue("maxNetProfit"),
    minMarginPercent: textValue("minMarginPercent"),
    maxMarginPercent: textValue("maxMarginPercent"),
    matchStatus: textValue("matchStatus") as AnalysisFilters["matchStatus"],
    minMatchConfidence: numberValue("minMatchConfidence"),
    packGuardStatus: textValue(
      "packGuardStatus",
    ) as AnalysisFilters["packGuardStatus"],
    featuredOfferState: textValue(
      "featuredOfferState",
    ) as AnalysisFilters["featuredOfferState"],
    amazonRetailPresence: textValue(
      "amazonRetailPresence",
    ) as AnalysisFilters["amazonRetailPresence"],
    pricingCompleteness: textValue(
      "pricingCompleteness",
    ) as AnalysisFilters["pricingCompleteness"],
    pricingFreshness: textValue(
      "pricingFreshness",
    ) as AnalysisFilters["pricingFreshness"],
    feeCompleteness: textValue(
      "feeCompleteness",
    ) as AnalysisFilters["feeCompleteness"],
    restrictionState: textValue(
      "restrictionState",
    ) as AnalysisFilters["restrictionState"],
    restrictionReasonCode: textValue(
      "restrictionReasonCode",
    ) as AnalysisFilters["restrictionReasonCode"],
    minVisibleOfferCount: numberValue("minVisibleOfferCount"),
    maxVisibleOfferCount: numberValue("maxVisibleOfferCount"),
    minFbaOfferCount: numberValue("minFbaOfferCount"),
    maxFbaOfferCount: numberValue("maxFbaOfferCount"),
    minFbmOfferCount: numberValue("minFbmOfferCount"),
    maxFbmOfferCount: numberValue("maxFbmOfferCount"),
    partialData: query.partialData === true ? true : undefined,
    supplierCode: textValue("supplierCode"),
    brand: textValue("brand"),
    category: textValue("category"),
  };
}

async function analysisTable(job: {
  organizationId: string;
  scanJobId: string | null;
  queryState: unknown;
  sourceRevision: number;
}): Promise<ExportTable> {
  if (!job.scanJobId) throw new Error("ANALYSIS_EXPORT_SOURCE_NOT_FOUND");
  const scan = await db.scanJob.findFirst({
    where: { id: job.scanJobId, organizationId: job.organizationId },
    select: { attemptCount: true },
  });
  if (!scan) throw new Error("ANALYSIS_EXPORT_SOURCE_NOT_FOUND");
  if (scan.attemptCount !== job.sourceRevision)
    throw new Error("ANALYSIS_EXPORT_SOURCE_STALE");
  const query = record(job.queryState);
  const routeId = typeof query.routeId === "string" ? query.routeId : undefined;
  const sort =
    typeof query.sort === "string"
      ? (query.sort as AnalysisSort)
      : "sourceRowNumber";
  const direction = query.direction === "desc" ? "desc" : "asc";
  const filters = analysisFiltersFromViewState(job.queryState);
  const columns = [
    "Supplier SKU",
    "Supplied ASIN",
    "UPC",
    "EAN",
    "GTIN",
    "Amazon ASIN",
    "Amazon title",
    "Brand",
    "Variation",
    "Product types",
    "Match status",
    "Match confidence",
    "PackGuard",
    "Featured offer state",
    "Featured offer price",
    "Amazon Retail presence",
    "Visible sellers",
    "Visible seller completeness",
    "FBA sellers",
    "FBM sellers",
    "Lowest FBA price",
    "Lowest FBM price",
    "Fee completeness",
    "Fee scenario source",
    "Fee component summary",
    "Landed COGS",
    "Net profit",
    "ROI %",
    "Margin %",
    "Recommendation",
    "Formula gates",
    "Eligibility",
    "Restriction reasons",
    "Pricing provider",
    "Pricing observed at",
    "Pricing freshness",
  ];
  const rows: Array<Array<string | number | null>> = [];
  for (let offset = 0; ; offset += ANALYSIS_EXPORT_PAGE_SIZE) {
    const page = await listAnalysisResults({
      organizationId: job.organizationId,
      scanJobId: job.scanJobId,
      ...(routeId ? { shippingRouteId: routeId } : {}),
      offset,
      limit: ANALYSIS_EXPORT_PAGE_SIZE,
      filters,
      sort,
      direction,
    });
    if (!page) throw new Error("ANALYSIS_EXPORT_SOURCE_NOT_FOUND");
    const rightsRequests = new Map<string, ProviderExportFieldRequest>();
    for (const result of page.rows) {
      const catalog =
        result.supplierRow.matchDecision?.selectedCandidate?.catalogProduct;
      addRightsRequest(rightsRequests, {
        provider: catalog?.provider,
        marketplaceId: catalog?.marketplaceId,
        capability: "CATALOG",
        fields: ["catalog.identity"],
      });
      addRightsRequest(rightsRequests, {
        provider: result.offerIntelligence?.provider,
        marketplaceId: result.offerIntelligence?.marketplaceId,
        capability: "COMPETITIVE_OFFERS",
        fields: [
          "pricing.offerIntelligence",
          "pricing.exportedFinancialInputs",
        ],
      });
      addRightsRequest(rightsRequests, {
        provider: result.feeEstimate?.provider,
        marketplaceId: result.feeEstimate?.marketplaceId,
        capability: "FEES",
        fields: ["fees.estimate", "fees.exportedFinancialInputs"],
      });
      addRightsRequest(rightsRequests, {
        provider: result.listingRestriction?.provider,
        marketplaceId: result.listingRestriction?.marketplaceId,
        capability: "RESTRICTIONS",
        fields: ["restrictions.eligibility"],
      });
    }
    await assertProviderExportRights(job.organizationId, rightsRequests);
    for (const result of page.rows) {
      const offer = result.supplierRow.normalizedOffer;
      const catalog =
        result.supplierRow.matchDecision?.selectedCandidate?.catalogProduct;
      const intelligence = result.offerIntelligence;
      rows.push([
        text(offer?.itemNumber),
        text(offer?.asin),
        text(offer?.upc),
        text(offer?.ean),
        text(offer?.gtin),
        text(catalog?.asin),
        text(catalog?.title),
        text(catalog?.brand ?? offer?.brand),
        text(catalog?.variation),
        catalog?.identity.productTypes.join(" | ") ?? "",
        text(result.supplierRow.matchDecision?.status),
        result.supplierRow.matchDecision?.confidence ?? null,
        text(
          result.supplierRow.matchDecision?.selectedCandidate?.packGuard
            ?.status,
        ),
        text(intelligence?.featuredOffer.state),
        text(intelligence?.featuredOffer.price),
        text(intelligence?.amazonRetailPresence),
        intelligence?.counts.total.value ?? null,
        text(intelligence?.counts.total.completeness),
        intelligence?.counts.fba.value ?? null,
        intelligence?.counts.fbm.value ?? null,
        text(intelligence?.lowestFbaPrice),
        text(intelligence?.lowestFbmPrice),
        text(result.feeEstimate?.completeness),
        text(result.feeEstimate?.scenarioSource),
        result.feeEstimate?.components
          .map(
            (component) =>
              `${component.type}:${component.finalFee} ${component.currency}`,
          )
          .join(" | ") ?? "",
        text(result.effectiveCogs),
        text(result.currentNetProfit),
        text(result.roiPercent),
        text(result.marginPercent),
        text(result.recommendation),
        stringList(result.reasonCodes).join(" | "),
        text(result.listingRestriction?.state),
        result.listingRestriction?.reasonCodes.join(" | ") ?? "",
        text(intelligence?.provider),
        text(intelligence?.observedAt),
        text(intelligence?.freshnessState),
      ]);
    }
    if (offset + page.rows.length >= page.total) break;
  }
  return { sheetName: "Active analysis view", columns, rows };
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
    const analysis =
      job.kind === "ANALYSIS_VIEW" ? await analysisTable(job) : null;
    const order = job.purchaseOrderId
      ? await loadOrder(job.purchaseOrderId)
      : null;
    const shortlist =
      !order && job.shortlistId ? await loadShortlist(job.shortlistId) : null;
    if (!analysis && !order && !shortlist)
      throw new Error("EXPORT_SOURCE_NOT_FOUND");
    if (
      (order && order.organizationId !== job.organizationId) ||
      (shortlist && shortlist.organizationId !== job.organizationId)
    )
      throw new Error("EXPORT_SOURCE_NOT_FOUND");
    if (
      (order && order.revision !== job.sourceRevision) ||
      (shortlist && shortlist.revision !== job.sourceRevision)
    )
      throw new Error("EXPORT_SOURCE_STALE");
    if (order && order.status !== "VALIDATED" && order.status !== "EXPORTED")
      throw new Error("PURCHASE_ORDER_NOT_VALIDATED");
    if (order)
      await assertProviderExportRights(
        job.organizationId,
        financialExportRightsRequests(
          order.lines.map((line) => {
            const catalog =
              line.supplierRow.matchDecision?.selectedCandidate?.catalogProduct;
            return {
              catalogProvider: catalog?.provider,
              marketplaceId: catalog?.marketplaceId,
              evidence: record(line.sourceSnapshot).evidence,
              scenarioType: order.scenarioType,
            };
          }),
        ),
      );
    if (shortlist)
      await assertProviderExportRights(
        job.organizationId,
        financialExportRightsRequests(
          shortlist.items.map((item) => {
            const catalog =
              item.profitResult.supplierRow.matchDecision?.selectedCandidate
                ?.catalogProduct;
            return {
              catalogProvider: catalog?.provider,
              marketplaceId: catalog?.marketplaceId,
              evidence: item.profitResult.evidence,
              scenarioType: item.profitResult.scenarioType,
            };
          }),
        ),
      );
    const table = analysis
      ? analysis
      : order
        ? poTable(order, job.kind === "AUDIT_REPORT")
        : shortlistTable(shortlist!);
    const tables =
      order && job.kind === "PURCHASE_ORDER"
        ? [poSummaryTable(order), table, poTable(order, true)]
        : [table];
    const bytes =
      job.format === "CSV"
        ? toCsv(table)
        : await createXlsxExport(xlsxPayload(tables));
    const checksumSha256 = createHash("sha256").update(bytes).digest("hex");
    const extension = job.format.toLowerCase();
    const filename = `rizpoint-${job.kind.toLowerCase()}-${job.scanJobId ?? order?.id ?? shortlist?.id}.${extension}`;
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
      if (order && job.kind === "PURCHASE_ORDER")
        await transaction.purchaseOrder.update({
          where: { id: order.id },
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
