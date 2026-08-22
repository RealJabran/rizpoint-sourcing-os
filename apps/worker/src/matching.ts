import {
  completeMatching,
  getCompletedMatchLookup,
  getCatalogProviderConnection,
  getScanRowsForMatching,
  persistMatchRow,
  saveMatchLookup,
} from "@rizpoint/database";
import {
  decideMatch,
  evaluatePackGuard,
  extractSupplierUnitsPerCase,
  matchingIdentifiers,
  normalizeText,
  scoreCandidate,
  type CandidateSource,
  type SupplierMatchInput,
} from "@rizpoint/matching-engine";
import {
  catalogProductSchema,
  type CatalogProduct,
  type CatalogProvider,
} from "@rizpoint/provider-contracts";
import { createEnrichmentProvider } from "./enrichment-provider.js";
import { accessProviderData } from "./provider-data-access.js";

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

export function isMatchingAttemptRunnable(status: string | null): boolean {
  return status === "MATCHING" || status === "FAILED_RETRYABLE";
}

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
  providerName: string,
  lookupKey: string,
  runtime: {
    providerKey: "amazon-sp-api" | "mock-amazon";
    mode: "LIVE" | "MOCK";
    marketplaceId: string;
    operation: string;
    requestIdentity: unknown;
  },
  request: () => Promise<readonly CatalogProduct[]>,
): Promise<readonly CatalogProduct[]> {
  const cached = await getCompletedMatchLookup(
    scanJobId,
    providerName,
    source,
    lookupKey,
  );
  if (cached?.status === "COMPLETED") {
    return catalogProductSchema.array().parse(cached.payload);
  }
  // Scan-local lookup persistence is sufficient for deterministic demo data.
  // Keeping MOCK out of the organization provider cache also prevents demo
  // fixtures from inflating live-call/cache telemetry and avoids thousands of
  // unnecessary cache rows in the large wholesale fixture. Every LIVE lookup
  // still goes through the shared persistent policy below.
  const products =
    runtime.mode === "MOCK"
      ? catalogProductSchema.array().parse(await request())
      : (
          await accessProviderData({
            organizationId,
            providerKey: runtime.providerKey,
            marketplaceId: runtime.marketplaceId,
            capability: "CATALOG",
            operation: runtime.operation,
            request: runtime.requestIdentity,
            mode: runtime.mode,
            parse: (projection) =>
              catalogProductSchema.array().parse(projection),
            fetch: async () => {
              const fetched = catalogProductSchema
                .array()
                .parse(await request());
              const first = fetched[0];
              return {
                projection: fetched,
                cacheProjection: fetched.map((product) => {
                  const normalized = structuredClone(product);
                  delete normalized.rawProviderObservation;
                  return normalized;
                }),
                observedAt: new Date(
                  first?.provenance.observedAt ?? new Date().toISOString(),
                ),
                completeness:
                  first?.provenance.responseCompleteness ??
                  ("UNKNOWN" as const),
              };
            },
          })
        ).projection;
  const first = products[0];
  await saveMatchLookup({
    organizationId,
    scanJobId,
    provider: providerName,
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
  provider: CatalogProvider,
  providerName: string,
  marketplace: import("@rizpoint/provider-contracts").MarketplaceContext,
  runtime: {
    providerKey: "amazon-sp-api" | "mock-amazon";
    mode: "LIVE" | "MOCK";
  },
) {
  const candidates = new Map<
    string,
    { product: CatalogProduct; source: CandidateSource }
  >();
  const suppliedAsin = matchingIdentifiers(input).find(
    ({ type }) => type === "ASIN",
  );
  if (suppliedAsin) {
    const asin = suppliedAsin.value;
    const products = await cachedLookup(
      organizationId,
      scanJobId,
      "SUPPLIED_ASIN",
      providerName,
      asin,
      {
        ...runtime,
        marketplaceId: marketplace.marketplaceId,
        operation: "getCatalogItem",
        requestIdentity: {
          operation: "getCatalogItem",
          asin,
          marketplaceId: marketplace.marketplaceId,
        },
      },
      async () => {
        const product = await provider.getItem(asin, marketplace);
        return product ? [product] : [];
      },
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
        providerName,
        `${identifier.type}:${identifier.value}`,
        {
          ...runtime,
          marketplaceId: marketplace.marketplaceId,
          operation: "searchCatalogByIdentifier",
          requestIdentity: {
            operation: "searchCatalogByIdentifier",
            identifier,
            marketplaceId: marketplace.marketplaceId,
          },
        },
        () => provider.searchByIdentifier(identifier, marketplace),
      );
      for (const product of products)
        candidates.set(product.asin, { product, source: "EXACT_IDENTIFIER" });
    }
  }
  if (candidates.size === 0 && input.mpn && input.brand) {
    const value = input.mpn;
    const products = await cachedLookup(
      organizationId,
      scanJobId,
      "MPN_BRAND",
      providerName,
      `${value}:${normalizeText(input.brand)}`,
      {
        ...runtime,
        marketplaceId: marketplace.marketplaceId,
        operation: "searchCatalogByKeywords",
        requestIdentity: {
          operation: "searchCatalogByKeywords",
          query: `${input.brand} ${value}`,
          marketplaceId: marketplace.marketplaceId,
        },
      },
      () => provider.searchByKeywords(`${input.brand} ${value}`, marketplace),
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
      providerName,
      input.description,
      {
        ...runtime,
        marketplaceId: marketplace.marketplaceId,
        operation: "searchCatalogByKeywords",
        requestIdentity: {
          operation: "searchCatalogByKeywords",
          query: input.description,
          marketplaceId: marketplace.marketplaceId,
        },
      },
      () => provider.searchByKeywords(input.description!, marketplace),
    );
    for (const product of products)
      candidates.set(product.asin, { product, source: "TITLE_SEARCH" });
  }
  return [...candidates.values()];
}

export async function processMatching(scanJobId: string) {
  const scan = await getScanRowsForMatching(scanJobId);
  if (!scan || !isMatchingAttemptRunnable(scan.status)) return;
  const connection = await getCatalogProviderConnection(scan.organizationId);
  const bundle = createEnrichmentProvider(connection);
  const providerName =
    bundle.providerKind === "MOCK_AMAZON" ? "mock-catalog" : "amazon-sp-api";
  for (const row of scan.supplierRows) {
    const input = asInput(row.normalizedOffer);
    const candidates = await cascade(
      scan.organizationId,
      scanJobId,
      input,
      bundle.provider,
      providerName,
      bundle.marketplace,
      { providerKey: bundle.providerKey, mode: bundle.mode },
    );
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
            input.caseCount ?? extractSupplierUnitsPerCase(input.description),
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
