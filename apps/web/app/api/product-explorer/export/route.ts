import { NextRequest, NextResponse } from "next/server";
import {
  ensurePhaseZeroOrganization,
  listProductExplorer,
  resolveProviderExportRights,
  type ProviderExportDecision,
  type ProviderExportFieldRequest,
} from "@rizpoint/database";
import { toCsv } from "@rizpoint/export-engine";
import { requirePrivateAccess } from "@/src/private-access";
import { productExplorerQuerySchema } from "@/src/product-explorer/contracts";
import { enforceApiRateLimit } from "@/src/api-rate-limit";

export const runtime = "nodejs";

const fields = {
  CATALOG: [
    "catalog.asin",
    "catalog.title",
    "catalog.brand",
    "catalog.category",
  ],
  COMPETITIVE_OFFERS: [
    "pricing.price",
    "pricing.currency",
    "pricing.offerCount",
    "pricing.fbaOfferCount",
    "pricing.fbmOfferCount",
    "pricing.amazonRetailPresence",
  ],
  MARKET_HISTORY: [
    "history.rating",
    "history.reviewCount",
    "history.salesRank",
    "history.priceVolatilityPercent",
    "history.status",
    "history.coveragePercent",
  ],
} as const;

function decisionKey(input: {
  providerKey: string;
  marketplaceId: string;
  capability: string;
}) {
  return `${input.providerKey}\u0000${input.marketplaceId}\u0000${input.capability}`;
}

/** Exports the same bounded server window displayed by Explorer. Raw provider
 * payloads are never included, and textual spreadsheet cells are neutralized. */
export async function GET(request: NextRequest) {
  const denied = requirePrivateAccess(request);
  if (denied) return denied;
  const parsed = productExplorerQuerySchema.safeParse({
    ...Object.fromEntries(request.nextUrl.searchParams),
    limit: 100,
    offset: 0,
  });
  if (!parsed.success)
    return NextResponse.json(
      { error: "INVALID_PRODUCT_EXPLORER_EXPORT" },
      { status: 400 },
    );
  const organization = await ensurePhaseZeroOrganization();
  const limited = await enforceApiRateLimit({
    request,
    organizationId: organization.id,
    scope: "product-explorer.export",
    limit: 10,
    windowSeconds: 60,
  });
  if (limited) return limited;
  const { offset, limit, ...filters } = parsed.data;
  const result = await listProductExplorer({
    organizationId: organization.id,
    offset,
    limit,
    filters,
  });
  const requestByKey = new Map<string, ProviderExportFieldRequest>();
  for (const row of result.rows) {
    const requests = [
      {
        providerKey: row.catalogProviderKey,
        capability: "CATALOG" as const,
        fields: fields.CATALOG,
      },
      {
        providerKey: row.pricingProviderKey,
        capability: "COMPETITIVE_OFFERS" as const,
        fields: fields.COMPETITIVE_OFFERS,
      },
      {
        providerKey: row.historyProviderKey,
        capability: "MARKET_HISTORY" as const,
        fields: fields.MARKET_HISTORY,
      },
    ];
    for (const provider of requests) {
      if (!provider.providerKey || !row.marketplaceId) continue;
      const request = {
        providerKey: provider.providerKey,
        marketplaceId: row.marketplaceId,
        capability: provider.capability,
        fields: provider.fields,
      };
      requestByKey.set(decisionKey(request), request);
    }
  }
  const decisions = requestByKey.size
    ? await resolveProviderExportRights({
        organizationId: organization.id,
        requests: [...requestByKey.values()],
      })
    : [];
  const decisionByKey = new Map(
    decisions.map((decision) => [decisionKey(decision), decision]),
  );
  const decisionFor = (
    providerKey: string | null,
    marketplaceId: string | null,
    capability: "CATALOG" | "COMPETITIVE_OFFERS" | "MARKET_HISTORY",
  ): ProviderExportDecision | null =>
    providerKey && marketplaceId
      ? (decisionByKey.get(
          decisionKey({ providerKey, marketplaceId, capability }),
        ) ?? null)
      : null;
  const exportValue = <T extends string | number | null>(
    decision: ProviderExportDecision | null,
    field: string,
    value: T,
  ) => (decision?.allowedFields.includes(field) ? value : null);
  const body = toCsv({
    sheetName: "Product Explorer",
    columns: [
      "ASIN",
      "Title",
      "Brand",
      "Category",
      "Price",
      "Currency",
      "Rating",
      "Reviews",
      "BSR",
      "Offers",
      "FBA offers",
      "FBM offers",
      "Amazon Retail",
      "90d price volatility %",
      "History status",
      "History coverage %",
      "Sources",
      "Export rights",
    ],
    rows: result.rows.map((row) => {
      const catalog = decisionFor(
        row.catalogProviderKey,
        row.marketplaceId,
        "CATALOG",
      );
      const pricing = decisionFor(
        row.pricingProviderKey,
        row.marketplaceId,
        "COMPETITIVE_OFFERS",
      );
      const history = decisionFor(
        row.historyProviderKey,
        row.marketplaceId,
        "MARKET_HISTORY",
      );
      return [
        exportValue(catalog, "catalog.asin", row.asin),
        exportValue(catalog, "catalog.title", row.title),
        exportValue(catalog, "catalog.brand", row.brand),
        exportValue(catalog, "catalog.category", row.category),
        exportValue(pricing, "pricing.price", row.price),
        exportValue(pricing, "pricing.currency", row.currency),
        exportValue(history, "history.rating", row.rating),
        exportValue(history, "history.reviewCount", row.reviewCount),
        exportValue(history, "history.salesRank", row.salesRank),
        exportValue(pricing, "pricing.offerCount", row.offerCount),
        exportValue(pricing, "pricing.fbaOfferCount", row.fbaOfferCount),
        exportValue(pricing, "pricing.fbmOfferCount", row.fbmOfferCount),
        exportValue(
          pricing,
          "pricing.amazonRetailPresence",
          row.amazonRetailPresence,
        ),
        exportValue(
          history,
          "history.priceVolatilityPercent",
          row.priceVolatilityPercent,
        ),
        exportValue(history, "history.status", row.historyStatus),
        exportValue(
          history,
          "history.coveragePercent",
          row.historyCoveragePercent,
        ),
        row.sources.join("; "),
        [
          `catalog:${catalog?.decision ?? "RIGHTS_NOT_CONFIGURED"}`,
          `pricing:${pricing?.decision ?? "RIGHTS_NOT_CONFIGURED"}`,
          `history:${history?.decision ?? "RIGHTS_NOT_CONFIGURED"}`,
        ].join("; "),
      ];
    }),
  });
  return new NextResponse(
    body.buffer.slice(
      body.byteOffset,
      body.byteOffset + body.byteLength,
    ) as ArrayBuffer,
    {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition":
          'attachment; filename="rizpoint-product-explorer.csv"',
        "cache-control": "no-store, private",
      },
    },
  );
}
