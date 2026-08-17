import { NextRequest, NextResponse } from "next/server";
import {
  ensurePhaseZeroOrganization,
  listProductExplorer,
} from "@rizpoint/database";
import { toCsv } from "@rizpoint/export-engine";
import { requirePrivateAccess } from "@/src/private-access";
import { productExplorerQuerySchema } from "@/src/product-explorer/contracts";

export const runtime = "nodejs";

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
  const { offset, limit, ...filters } = parsed.data;
  const result = await listProductExplorer({
    organizationId: organization.id,
    offset,
    limit,
    filters,
  });
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
    ],
    rows: result.rows.map((row) => [
      row.asin,
      row.title,
      row.brand,
      row.category,
      row.price,
      row.currency,
      row.rating,
      row.reviewCount,
      row.salesRank,
      row.offerCount,
      row.fbaOfferCount,
      row.fbmOfferCount,
      row.amazonRetailPresence,
      row.priceVolatilityPercent,
      row.historyStatus,
      row.historyCoveragePercent,
      row.sources.join("; "),
    ]),
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
