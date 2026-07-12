import {
  completeMatching,
  getCompletedMatchLookup,
  getScanRowsForMatching,
  persistMatchRow,
  saveMatchLookup,
} from "@rizpoint/database";
import {
  decideMatch,
  evaluatePackGuard,
  matchingIdentifiers,
  normalizeText,
  scoreCandidate,
  type CandidateSource,
  type SupplierMatchInput,
} from "@rizpoint/matching-engine";
import { MockCatalogProvider } from "@rizpoint/mock-providers";
import {
  catalogProductSchema,
  type CatalogProduct,
  type CatalogProvider,
} from "@rizpoint/provider-contracts";

const provider: CatalogProvider = new MockCatalogProvider();

type MatchingOffer = {
  asin: string | null;
  upc: string | null;
  ean: string | null;
  gtin: string | null;
  mpn: string | null;
  itemNumber: string | null;
  description: string | null;
  brand: string | null;
  packCount: number | null;
  caseCount: number | null;
  quantity: number | null;
  unitCost: { toString(): string } | null;
} | null;

function asInput(offer: MatchingOffer): SupplierMatchInput {
  return {
    asin: offer?.asin ?? null,
    upc: offer?.upc ?? null,
    ean: offer?.ean ?? null,
    gtin: offer?.gtin ?? null,
    mpn: offer?.mpn ?? null,
    itemNumber: offer?.itemNumber ?? null,
    description: offer?.description ?? null,
    brand: offer?.brand ?? null,
    packCount: offer?.packCount ?? null,
    caseCount: offer?.caseCount ?? null,
    quantity: offer?.quantity ?? null,
    unitCost: offer?.unitCost?.toString() ?? null,
  };
}

async function cachedLookup(
  organizationId: string,
  scanJobId: string,
  source: CandidateSource,
  lookupKey: string,
  request: () => Promise<readonly CatalogProduct[]>,
): Promise<readonly CatalogProduct[]> {
  const cached = await getCompletedMatchLookup(
    scanJobId,
    "mock-catalog",
    source,
    lookupKey,
  );
  if (cached?.status === "COMPLETED") {
    return catalogProductSchema.array().parse(cached.payload);
  }
  const products = await request();
  const first = products[0];
  await saveMatchLookup({
    organizationId,
    scanJobId,
    provider: "mock-catalog",
    lookupType: source,
    lookupKey,
    payload:
      products as unknown as import("@rizpoint/database").Prisma.InputJsonValue,
    observedAt: new Date(
      first?.provenance.observedAt ?? new Date().toISOString(),
    ),
    freshnessState: first?.provenance.freshnessState ?? "UNKNOWN",
  });
  return products;
}

async function cascade(
  organizationId: string,
  scanJobId: string,
  input: SupplierMatchInput,
) {
  const candidates = new Map<
    string,
    { product: CatalogProduct; source: CandidateSource }
  >();
  if (input.asin) {
    const asin = input.asin.trim().toUpperCase();
    const product = await provider.getItem(asin);
    const products = await cachedLookup(
      organizationId,
      scanJobId,
      "SUPPLIED_ASIN",
      asin,
      async () => (product ? [product] : []),
    );
    for (const result of products)
      candidates.set(result.asin, { product: result, source: "SUPPLIED_ASIN" });
  }
  if (candidates.size === 0) {
    for (const identifier of matchingIdentifiers(input).filter(
      ({ type }) => type !== "ASIN" && type !== "MPN",
    )) {
      const products = await cachedLookup(
        organizationId,
        scanJobId,
        "EXACT_IDENTIFIER",
        `${identifier.type}:${identifier.value}`,
        () => provider.searchByIdentifier(identifier),
      );
      for (const product of products)
        candidates.set(product.asin, { product, source: "EXACT_IDENTIFIER" });
    }
  }
  if (candidates.size === 0 && (input.mpn ?? input.itemNumber) && input.brand) {
    const value = input.mpn ?? input.itemNumber!;
    const products = await cachedLookup(
      organizationId,
      scanJobId,
      "MPN_BRAND",
      `${value}:${normalizeText(input.brand)}`,
      () => provider.searchByIdentifier({ type: "MPN", value }),
    );
    for (const product of products) {
      if (normalizeText(product.brand) === normalizeText(input.brand))
        candidates.set(product.asin, { product, source: "MPN_BRAND" });
    }
  }
  if (candidates.size === 0 && input.description) {
    const products = await cachedLookup(
      organizationId,
      scanJobId,
      "TITLE_SEARCH",
      input.description,
      () => provider.searchByKeywords(input.description!),
    );
    for (const product of products)
      candidates.set(product.asin, { product, source: "TITLE_SEARCH" });
  }
  return [...candidates.values()];
}

export async function processMatching(scanJobId: string) {
  const scan = await getScanRowsForMatching(scanJobId);
  if (!scan || scan.status !== "MATCHING") return;
  for (const row of scan.supplierRows) {
    const input = asInput(row.normalizedOffer);
    const candidates = await cascade(scan.organizationId, scanJobId, input);
    const scored = candidates.map(({ product, source }) =>
      scoreCandidate(input, product, source),
    );
    const decision = decideMatch(scored);
    await persistMatchRow({
      organizationId: scan.organizationId,
      supplierRowId: row.id,
      candidates: scored.map((candidate) => ({
        source: candidate.source,
        confidence: candidate.confidence,
        product: candidate.product,
        evidence: [...candidate.evidence],
        packGuard: evaluatePackGuard({
          supplierUnitsPerCase:
            input.caseCount ?? input.quantity ?? input.packCount ?? null,
          amazonUnitsPerPack: candidate.product.packCount ?? null,
          supplierUnitCost: input.unitCost ?? null,
        }),
      })),
      decision: {
        status: decision.status,
        confidence: decision.confidence,
        selectedAsin: decision.selected?.product.asin ?? null,
        reasonCodes: [...decision.reasonCodes],
      },
    });
  }
  await completeMatching(scanJobId, scan.supplierRows.length);
}
