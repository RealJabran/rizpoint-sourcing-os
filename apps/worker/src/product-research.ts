import {
  claimProductResearchRun,
  completeProductResearchRun,
  getCatalogProviderConnection,
  type PersistedResearchItem,
} from "@rizpoint/database";
import {
  catalogProductSchema,
  competitivePricingSchema,
  feeEstimateSchema,
  ProviderError,
  restrictionsSchema,
  type CatalogProduct,
} from "@rizpoint/provider-contracts";
import { z } from "zod";
import { createEnrichmentProvider } from "./enrichment-provider.js";
import {
  feeRequestInputs,
  pricingRequestInputs,
  restrictionRequestInputs,
} from "./enrichment-policy.js";
import {
  accessProviderData,
  type ProviderDataResult,
} from "./provider-data-access.js";

const catalogArraySchema = z.array(catalogProductSchema);

function withoutRaw<T extends { rawProviderObservation?: unknown }>(value: T) {
  const safe = { ...value };
  delete safe.rawProviderObservation;
  return safe;
}

function dataOrigin(
  mode: "LIVE" | "MOCK",
  source: ProviderDataResult<unknown>["source"],
) {
  if (mode === "MOCK") return "MOCK" as const;
  return source === "PROVIDER"
    ? ("LIVE_AMAZON" as const)
    : ("STORED_AMAZON" as const);
}

function providerLabel(mode: "LIVE" | "MOCK") {
  return mode === "LIVE"
    ? "Amazon Selling Partner API"
    : "Recorded demo fixture";
}

function safeProviderError(error: unknown) {
  return error instanceof ProviderError ? error.code : "UNAVAILABLE";
}

async function optionalEvidence<T>(
  mode: "LIVE" | "MOCK",
  marketplaceId: string,
  work: () => Promise<ProviderDataResult<T>>,
) {
  try {
    const result = await work();
    return {
      status: "AVAILABLE" as const,
      value: result.projection,
      observedAt: result.observedAt.toISOString(),
      freshUntil: result.freshUntil.toISOString(),
      freshness:
        result.source === "PERSISTED_STALE"
          ? ("STALE" as const)
          : ("FRESH" as const),
      completeness: result.completeness,
      cacheOutcome: result.cacheOutcome,
      providerCalled: result.providerCalled,
      source: providerLabel(mode),
      dataOrigin: dataOrigin(mode, result.source),
      marketplaceId,
    };
  } catch (error) {
    if (
      error instanceof ProviderError &&
      ["THROTTLED", "TRANSIENT", "PROVIDER_OUTAGE"].includes(error.code)
    )
      throw error;
    return {
      status: "UNAVAILABLE" as const,
      reason: safeProviderError(error),
    };
  }
}

export async function processProductResearchRun(runId: string) {
  const run = await claimProductResearchRun(runId);
  if (!run) return;
  const connection = await getCatalogProviderConnection(
    run.organizationId,
    run.marketplaceId,
  );
  const bundle = createEnrichmentProvider(connection);
  if (
    bundle.providerKey !== run.providerKey ||
    bundle.mode !== run.providerMode ||
    bundle.marketplace.marketplaceId !== run.marketplaceId
  )
    throw new ProviderError("UNAUTHORIZED");

  const catalogRequest = {
    operation:
      run.kind === "CATALOG_SEARCH"
        ? "searchCatalogItemsByKeywords"
        : run.queryType === "ASIN"
          ? "getCatalogItem"
          : "searchCatalogItems",
    marketplaceId: run.marketplaceId,
    queryType: run.queryType,
    query: run.normalizedQuery,
    limit: run.requestedLimit,
  };
  const catalog = await accessProviderData({
    organizationId: run.organizationId,
    providerKey: bundle.providerKey,
    marketplaceId: run.marketplaceId,
    capability: "CATALOG",
    operation: catalogRequest.operation,
    request: catalogRequest,
    mode: bundle.mode,
    forceRefresh: run.forceRefresh,
    parse: (projection) => catalogArraySchema.parse(projection),
    fetch: async () => {
      const products =
        run.kind === "CATALOG_SEARCH"
          ? await bundle.provider.searchByKeywords(
              run.normalizedQuery,
              bundle.marketplace,
            )
          : run.queryType === "ASIN"
            ? [
                await bundle.provider.getItem(
                  run.normalizedQuery,
                  bundle.marketplace,
                ),
              ].filter((product): product is CatalogProduct => product !== null)
            : await bundle.provider.searchByIdentifier(
                {
                  type: run.queryType as "UPC" | "EAN" | "GTIN",
                  value: run.normalizedQuery,
                },
                bundle.marketplace,
              );
      const bounded = [...products].slice(0, run.requestedLimit);
      const observedAt = new Date(
        bounded[0]?.provenance.observedAt ?? new Date().toISOString(),
      );
      return {
        projection: bounded,
        cacheProjection: bounded.map(withoutRaw),
        observedAt,
        completeness: bounded.some(
          (product) => product.provenance.responseCompleteness === "PARTIAL",
        )
          ? ("PARTIAL" as const)
          : ("COMPLETE" as const),
      };
    },
  });

  const products = catalog.projection.slice(0, run.requestedLimit);
  const items: PersistedResearchItem[] = [];
  for (const product of products) {
    const evidence: Record<string, unknown> = {
      catalog: {
        status: "AVAILABLE",
        product: withoutRaw(product),
        observedAt: catalog.observedAt.toISOString(),
        freshUntil: catalog.freshUntil.toISOString(),
        freshness: catalog.source === "PERSISTED_STALE" ? "STALE" : "FRESH",
        completeness: catalog.completeness,
        cacheOutcome: catalog.cacheOutcome,
        providerCalled: catalog.providerCalled,
        source: providerLabel(bundle.mode),
        dataOrigin: dataOrigin(bundle.mode, catalog.source),
        marketplaceId: run.marketplaceId,
      },
      researchedUniverse: {
        kind:
          run.kind === "CATALOG_SEARCH"
            ? "AMAZON_CATALOG_KEYWORD_RESULTS"
            : "EXACT_PRODUCT_LOOKUP",
        query: run.queryText,
        returnedCount: products.length,
        requestedLimit: run.requestedLimit,
        statement:
          run.kind === "CATALOG_SEARCH"
            ? "Bounded Amazon Catalog Items results; not the entire Amazon database, market size, or demand."
            : "Exact researched identifier in the connected marketplace.",
      },
    };
    let itemCompleteness = catalog.completeness;
    if (run.kind === "PRODUCT_LOOKUP") {
      const pricingInputs = pricingRequestInputs(
        product.asin,
        run.marketplaceId,
      );
      const pricing = await optionalEvidence(
        bundle.mode,
        run.marketplaceId,
        () =>
          accessProviderData({
            organizationId: run.organizationId,
            providerKey: bundle.providerKey,
            marketplaceId: run.marketplaceId,
            capability: "COMPETITIVE_OFFERS",
            operation: "getCompetitiveSummary",
            request: pricingInputs,
            mode: bundle.mode,
            forceRefresh: run.forceRefresh,
            parse: (projection) => competitivePricingSchema.parse(projection),
            fetch: async () => {
              const projection = await bundle.provider.getCompetitivePricing(
                product.asin,
                bundle.marketplace,
              );
              return {
                projection,
                cacheProjection: withoutRaw(projection),
                observedAt: new Date(projection.provenance.observedAt),
                completeness: projection.value.completeness,
              };
            },
          }),
      );
      evidence.pricing =
        pricing.status === "AVAILABLE"
          ? { ...pricing, value: withoutRaw(pricing.value) }
          : pricing;

      const pricingValue =
        pricing.status === "AVAILABLE" ? pricing.value.value : undefined;
      const price =
        run.salePrice?.toString() ?? pricingValue?.featuredOffer?.landedPrice;
      const currency = run.currency ?? pricingValue?.featuredOffer?.currency;
      const fulfillment = pricingValue?.featuredOffer?.fulfillmentChannel;
      if (
        price &&
        currency &&
        (fulfillment === "AMAZON" || fulfillment === "MERCHANT")
      ) {
        const scenarioSource = run.salePrice
          ? ("USER_ENTERED" as const)
          : ("CURRENT_FEATURED_OFFER" as const);
        const request = {
          asin: product.asin,
          marketplace: bundle.marketplace,
          price,
          listingPrice: price,
          shippingPrice: "0",
          currency,
          fulfillmentChannel: fulfillment,
          scenarioSource,
          requestId: `${run.id}:${product.asin}:${scenarioSource}:${price}`,
        };
        const feeInputs = feeRequestInputs({
          asin: product.asin,
          marketplaceId: run.marketplaceId,
          price,
          listingPrice: price,
          shippingPrice: "0",
          currency,
          fulfillmentChannel: fulfillment,
          scenarioSource,
        });
        const fees = await optionalEvidence(
          bundle.mode,
          run.marketplaceId,
          () =>
            accessProviderData({
              organizationId: run.organizationId,
              providerKey: bundle.providerKey,
              marketplaceId: run.marketplaceId,
              capability: "FEES",
              operation: "getMyFeesEstimateForASIN",
              request: feeInputs,
              mode: bundle.mode,
              forceRefresh: run.forceRefresh,
              parse: (projection) => feeEstimateSchema.parse(projection),
              fetch: async () => {
                const projection = await bundle.provider.estimateFees(request);
                return {
                  projection,
                  cacheProjection: withoutRaw(projection),
                  observedAt: new Date(projection.provenance.observedAt),
                  completeness: projection.value.completeness,
                };
              },
            }),
        );
        evidence.fees =
          fees.status === "AVAILABLE"
            ? { ...fees, value: withoutRaw(fees.value) }
            : fees;
      } else {
        evidence.fees = {
          status: "UNAVAILABLE",
          reason: "SALE_PRICE_SCENARIO_REQUIRED",
        };
      }

      const restrictionInputs = restrictionRequestInputs(
        product.asin,
        run.marketplaceId,
      );
      const restrictions = await optionalEvidence(
        bundle.mode,
        run.marketplaceId,
        () =>
          accessProviderData({
            organizationId: run.organizationId,
            providerKey: bundle.providerKey,
            marketplaceId: run.marketplaceId,
            capability: "RESTRICTIONS",
            operation: "getListingsRestrictions",
            request: restrictionInputs,
            mode: bundle.mode,
            forceRefresh: run.forceRefresh,
            parse: (projection) => restrictionsSchema.parse(projection),
            fetch: async () => {
              const projection = await bundle.provider.getRestrictions(
                product.asin,
                bundle.marketplace,
              );
              return {
                projection,
                cacheProjection: withoutRaw(projection),
                observedAt: new Date(projection.provenance.observedAt),
                completeness: projection.value.completeness,
              };
            },
          }),
      );
      evidence.restrictions =
        restrictions.status === "AVAILABLE"
          ? { ...restrictions, value: withoutRaw(restrictions.value) }
          : restrictions;
      evidence.history = {
        status: "PROVIDER_REQUIRED",
        reason: "Amazon SP-API does not provide historical market series.",
      };
      evidence.salesEstimate = {
        status: "UNAVAILABLE",
        reason: "No licensed estimate or calibrated model was invoked.",
      };
      if (
        [evidence.pricing, evidence.fees, evidence.restrictions].some(
          (entry) =>
            !!entry &&
            typeof entry === "object" &&
            (entry as { status?: string }).status !== "AVAILABLE",
        )
      )
        itemCompleteness = "PARTIAL";
    }
    items.push({
      product,
      evidence,
      source: providerLabel(bundle.mode),
      dataOrigin: dataOrigin(bundle.mode, catalog.source),
      observedAt: catalog.observedAt,
      freshUntil: catalog.freshUntil,
      freshnessState: catalog.source === "PERSISTED_STALE" ? "STALE" : "FRESH",
      completeness: itemCompleteness,
      status: itemCompleteness === "COMPLETE" ? "COMPLETED" : "PARTIAL_SUCCESS",
    });
  }
  await completeProductResearchRun({
    runId: run.id,
    organizationId: run.organizationId,
    items,
  });
}
