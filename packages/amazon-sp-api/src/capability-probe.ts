import type {
  CatalogIdentifier,
  CatalogProduct,
  FeeEstimateRequest,
  FeeProvider,
  MarketplaceContext,
  PricingProvider,
  ProviderCapability,
  ProviderOperationalState,
  ProviderUnavailableReason,
  RestrictionProvider,
} from "@rizpoint/provider-contracts";
import { ProviderError } from "@rizpoint/provider-contracts";

type ProbeProvider = {
  getItem(
    asin: string,
    marketplace: MarketplaceContext,
  ): Promise<CatalogProduct | null>;
  searchByIdentifier(
    identifier: CatalogIdentifier,
    marketplace: MarketplaceContext,
  ): Promise<readonly CatalogProduct[]>;
  searchByKeywords(
    keywords: string,
    marketplace: MarketplaceContext,
  ): Promise<readonly CatalogProduct[]>;
} & Pick<PricingProvider, "getCompetitivePricingBatch"> &
  FeeProvider &
  RestrictionProvider;

export type AmazonCapabilityProbeOperation = {
  operation:
    | "searchCatalogItems:keywords"
    | "getCatalogItem"
    | "searchCatalogItems:identifier"
    | "getCompetitiveSummary"
    | "getMyFeesEstimateForASIN"
    | "getListingsRestrictions";
  capability: Extract<
    ProviderCapability,
    "CATALOG" | "COMPETITIVE_OFFERS" | "FEES" | "RESTRICTIONS"
  >;
  state: ProviderOperationalState;
  completeness: "COMPLETE" | "PARTIAL" | "UNKNOWN";
  source: "amazon-sp-api";
  dataOrigin: "LIVE_AMAZON";
  marketplaceId: string;
  checkedAt: string;
  observedAt?: string;
  freshness: "FRESH" | "UNKNOWN";
  reason?: ProviderUnavailableReason;
  errorCode?: string;
  httpStatus?: number;
  providerRequestId?: string;
  rateLimitPerSecond?: string;
  retryAt?: string;
  identifierType?: "UPC" | "EAN" | "GTIN";
  requestedCount: number;
  returnedCount?: number;
};

export type AmazonCapabilityProbeResult = {
  reportVersion: "amazon-capability-probe/v1";
  provider: "amazon-sp-api";
  dataOrigin: "LIVE_AMAZON";
  marketplaceId: string;
  checkedAt: string;
  probeAsinCount: number;
  operations: AmazonCapabilityProbeOperation[];
  capabilities: Array<{
    capability: AmazonCapabilityProbeOperation["capability"];
    state: ProviderOperationalState;
    completeness: "COMPLETE" | "PARTIAL" | "UNKNOWN";
    checkedAt: string;
    retryAt?: string;
    reason?: ProviderUnavailableReason;
  }>;
};

type Provenance = {
  observedAt: string;
  freshnessState: "FRESH" | "STALE" | "EXPIRED" | "UNKNOWN";
  responseCompleteness?: "COMPLETE" | "PARTIAL";
  requestId?: string;
  rateLimitPerSecond?: string;
};

function provenance(value: unknown): Provenance | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = (value as { provenance?: unknown }).provenance;
  if (!candidate || typeof candidate !== "object") return undefined;
  const item = candidate as Partial<Provenance>;
  return typeof item.observedAt === "string" &&
    typeof item.freshnessState === "string"
    ? (item as Provenance)
    : undefined;
}

function retryAt(error: ProviderError, now: Date): string | undefined {
  if (error.options.retryAfterMs === undefined) return undefined;
  return new Date(now.getTime() + error.options.retryAfterMs).toISOString();
}

function failure(
  error: unknown,
  now: Date,
): Pick<
  AmazonCapabilityProbeOperation,
  | "state"
  | "completeness"
  | "freshness"
  | "reason"
  | "errorCode"
  | "httpStatus"
  | "providerRequestId"
  | "retryAt"
> {
  if (!(error instanceof ProviderError))
    return {
      state: "UNAVAILABLE",
      completeness: "UNKNOWN",
      freshness: "UNKNOWN",
      reason: "PROVIDER_OUTAGE",
      errorCode: "UNEXPECTED_PROVIDER_FAILURE",
    };
  const unauthorized =
    error.code === "UNAUTHORIZED" || error.code === "FORBIDDEN";
  const throttled = error.code === "THROTTLED";
  const invalid =
    error.code === "INVALID_RESPONSE" || error.code === "INVALID_REQUEST";
  const absent = error.code === "NOT_FOUND";
  const providerRetryAt = retryAt(error, now);
  return {
    state: unauthorized
      ? "UNAUTHORIZED"
      : throttled
        ? "THROTTLED"
        : invalid
          ? "PARTIAL"
          : absent
            ? "AUTHORIZED"
            : "UNAVAILABLE",
    completeness: "UNKNOWN",
    freshness: "UNKNOWN",
    reason:
      error.code === "FORBIDDEN"
        ? "CAPABILITY_NOT_ENTITLED"
        : error.code === "UNAUTHORIZED"
          ? "CONNECTION_NOT_AUTHORIZED"
          : throttled
            ? "PROVIDER_THROTTLED"
            : invalid
              ? "PARTIAL_RESPONSE"
              : absent
                ? "DATA_NOT_RETURNED"
                : "PROVIDER_OUTAGE",
    errorCode: error.code,
    ...(error.options.httpStatus === undefined
      ? {}
      : { httpStatus: error.options.httpStatus }),
    ...(error.options.providerRequestId
      ? { providerRequestId: error.options.providerRequestId }
      : {}),
    ...(providerRetryAt ? { retryAt: providerRetryAt } : {}),
  };
}

function success(
  value: unknown,
  now: Date,
): Pick<
  AmazonCapabilityProbeOperation,
  | "state"
  | "completeness"
  | "freshness"
  | "observedAt"
  | "providerRequestId"
  | "rateLimitPerSecond"
> {
  const source = provenance(value);
  const completeness = source?.responseCompleteness ?? "COMPLETE";
  return {
    state: completeness === "COMPLETE" ? "HEALTHY" : "PARTIAL",
    completeness,
    freshness: source?.freshnessState === "FRESH" ? "FRESH" : "UNKNOWN",
    observedAt: source?.observedAt ?? now.toISOString(),
    ...(source?.requestId ? { providerRequestId: source.requestId } : {}),
    ...(source?.rateLimitPerSecond
      ? { rateLimitPerSecond: source.rateLimitPerSecond }
      : {}),
  };
}

function aggregate(
  capability: AmazonCapabilityProbeOperation["capability"],
  operations: readonly AmazonCapabilityProbeOperation[],
  checkedAt: string,
) {
  const items = operations.filter((item) => item.capability === capability);
  const successful = items.filter((item) =>
    ["HEALTHY", "PARTIAL"].includes(item.state),
  );
  const first = (state: ProviderOperationalState) =>
    items.find((item) => item.state === state);
  const failureState =
    first("UNAUTHORIZED") ??
    first("THROTTLED") ??
    first("UNAVAILABLE") ??
    first("NOT_CONFIGURED");
  const authorizedOnly = !successful.length && first("AUTHORIZED");
  if (!successful.length && failureState)
    return {
      capability,
      state: failureState.state,
      completeness: "UNKNOWN" as const,
      checkedAt,
      ...(failureState.retryAt ? { retryAt: failureState.retryAt } : {}),
      ...(failureState.reason ? { reason: failureState.reason } : {}),
    };
  if (authorizedOnly)
    return {
      capability,
      state: "AUTHORIZED" as const,
      completeness: "UNKNOWN" as const,
      checkedAt,
      reason: authorizedOnly.reason ?? ("DATA_NOT_RETURNED" as const),
    };
  const partial =
    successful.some((item) => item.state === "PARTIAL") ||
    items.some((item) => !["HEALTHY", "AUTHORIZED"].includes(item.state));
  return {
    capability,
    state: partial ? ("PARTIAL" as const) : ("HEALTHY" as const),
    completeness: partial ? ("PARTIAL" as const) : ("COMPLETE" as const),
    checkedAt,
    ...(failureState?.retryAt ? { retryAt: failureState.retryAt } : {}),
    ...(partial
      ? { reason: failureState?.reason ?? ("PARTIAL_RESPONSE" as const) }
      : {}),
  };
}

export async function probeAmazonCapabilities(input: {
  provider: ProbeProvider;
  marketplace: MarketplaceContext;
  asins?: readonly string[];
  keyword?: string;
  feePrice: string;
  currency: string;
  fulfillmentChannel?: "AMAZON" | "MERCHANT";
  now?: Date;
}): Promise<AmazonCapabilityProbeResult> {
  const now = input.now ?? new Date();
  const checkedAt = now.toISOString();
  const providedAsins = [...new Set(input.asins ?? [])];
  if (
    providedAsins.length > 5 ||
    providedAsins.some((asin) => !/^B[A-Z0-9]{9}$/.test(asin)) ||
    !/^\d+(\.\d{1,4})?$/.test(input.feePrice) ||
    !/^[A-Z]{3}$/.test(input.currency)
  )
    throw new ProviderError("INVALID_REQUEST");
  const operations: AmazonCapabilityProbeOperation[] = [];
  const base = (
    operation: AmazonCapabilityProbeOperation["operation"],
    capability: AmazonCapabilityProbeOperation["capability"],
    requestedCount: number,
  ) => ({
    operation,
    capability,
    source: "amazon-sp-api" as const,
    dataOrigin: "LIVE_AMAZON" as const,
    marketplaceId: input.marketplace.marketplaceId,
    checkedAt,
    requestedCount,
  });

  let keywordProducts: readonly CatalogProduct[] = [];
  try {
    keywordProducts = await input.provider.searchByKeywords(
      input.keyword?.trim() || "water bottle",
      input.marketplace,
    );
    const first = keywordProducts[0];
    operations.push({
      ...base("searchCatalogItems:keywords", "CATALOG", 1),
      ...(first
        ? success(first, now)
        : {
            state: "AUTHORIZED" as const,
            completeness: "UNKNOWN" as const,
            freshness: "UNKNOWN" as const,
            reason: "DATA_NOT_RETURNED" as const,
          }),
      returnedCount: keywordProducts.length,
    });
  } catch (error) {
    operations.push({
      ...base("searchCatalogItems:keywords", "CATALOG", 1),
      ...failure(error, now),
    });
  }

  const asins = providedAsins.length
    ? providedAsins
    : keywordProducts[0]?.asin
      ? [keywordProducts[0].asin]
      : [];
  const catalogProducts: CatalogProduct[] = [];
  for (const asin of asins) {
    try {
      const product = await input.provider.getItem(asin, input.marketplace);
      if (product) catalogProducts.push(product);
      operations.push({
        ...base("getCatalogItem", "CATALOG", 1),
        ...(product
          ? success(product, now)
          : {
              state: "AUTHORIZED" as const,
              completeness: "UNKNOWN" as const,
              freshness: "UNKNOWN" as const,
              reason: "DATA_NOT_RETURNED" as const,
            }),
        returnedCount: product ? 1 : 0,
      });
    } catch (error) {
      operations.push({
        ...base("getCatalogItem", "CATALOG", 1),
        ...failure(error, now),
      });
    }
  }

  if (asins[0]) {
    const barcode = catalogProducts
      .flatMap((product) => product.identifiers ?? [])
      .find(
        (item): item is CatalogIdentifier & { type: "UPC" | "EAN" | "GTIN" } =>
          ["UPC", "EAN", "GTIN"].includes(item.type),
      );
    if (!barcode)
      operations.push({
        ...base("searchCatalogItems:identifier", "CATALOG", 1),
        state: "AUTHORIZED",
        completeness: "UNKNOWN",
        freshness: "UNKNOWN",
        reason: "DATA_NOT_RETURNED",
        requestedCount: 0,
      });
    else {
      try {
        const products = await input.provider.searchByIdentifier(
          barcode,
          input.marketplace,
        );
        operations.push({
          ...base("searchCatalogItems:identifier", "CATALOG", 1),
          identifierType: barcode.type,
          ...(products[0]
            ? success(products[0], now)
            : {
                state: "AUTHORIZED" as const,
                completeness: "UNKNOWN" as const,
                freshness: "UNKNOWN" as const,
                reason: "DATA_NOT_RETURNED" as const,
              }),
          returnedCount: products.length,
        });
      } catch (error) {
        operations.push({
          ...base("searchCatalogItems:identifier", "CATALOG", 1),
          identifierType: barcode.type,
          ...failure(error, now),
        });
      }
    }
  }

  if (asins.length && input.provider.getCompetitivePricingBatch) {
    try {
      const results = await input.provider.getCompetitivePricingBatch(
        asins,
        input.marketplace,
      );
      const successes = results.filter((item) => item.status === "SUCCESS");
      const errors = results.filter((item) => item.status === "ERROR");
      const firstSuccess = successes[0];
      const firstError = errors[0];
      operations.push({
        ...base("getCompetitiveSummary", "COMPETITIVE_OFFERS", asins.length),
        ...(firstSuccess
          ? {
              ...success(firstSuccess.pricing, now),
              ...(errors.length
                ? {
                    state: "PARTIAL" as const,
                    completeness: "PARTIAL" as const,
                    reason: "PARTIAL_RESPONSE" as const,
                  }
                : {}),
            }
          : firstError
            ? failure(
                new ProviderError(firstError.error.code, firstError.error),
                now,
              )
            : failure(new ProviderError("INVALID_RESPONSE"), now)),
        returnedCount: successes.length,
      });
    } catch (error) {
      operations.push({
        ...base("getCompetitiveSummary", "COMPETITIVE_OFFERS", asins.length),
        ...failure(error, now),
      });
    }
  }

  for (const asin of asins) {
    const request: FeeEstimateRequest = {
      asin,
      marketplace: input.marketplace,
      fulfillmentChannel: input.fulfillmentChannel ?? "AMAZON",
      scenarioSource: "USER_ENTERED",
      price: input.feePrice,
      listingPrice: input.feePrice,
      shippingPrice: "0",
      currency: input.currency,
      requestId: `capability-probe:${asin}:${input.feePrice}`,
    };
    try {
      const estimate = await input.provider.estimateFees(request);
      operations.push({
        ...base("getMyFeesEstimateForASIN", "FEES", 1),
        ...success(estimate, now),
        returnedCount: 1,
      });
    } catch (error) {
      operations.push({
        ...base("getMyFeesEstimateForASIN", "FEES", 1),
        ...failure(error, now),
      });
    }
    try {
      const restrictions = await input.provider.getRestrictions(
        asin,
        input.marketplace,
      );
      operations.push({
        ...base("getListingsRestrictions", "RESTRICTIONS", 1),
        ...success(restrictions, now),
        returnedCount: 1,
      });
    } catch (error) {
      operations.push({
        ...base("getListingsRestrictions", "RESTRICTIONS", 1),
        ...failure(error, now),
      });
    }
  }

  for (const capability of [
    "COMPETITIVE_OFFERS",
    "FEES",
    "RESTRICTIONS",
  ] as const) {
    if (!operations.some((item) => item.capability === capability))
      operations.push({
        ...base(
          capability === "COMPETITIVE_OFFERS"
            ? "getCompetitiveSummary"
            : capability === "FEES"
              ? "getMyFeesEstimateForASIN"
              : "getListingsRestrictions",
          capability,
          0,
        ),
        state: "AUTHORIZED",
        completeness: "UNKNOWN",
        freshness: "UNKNOWN",
        reason: "DATA_NOT_RETURNED",
      });
  }

  return {
    reportVersion: "amazon-capability-probe/v1",
    provider: "amazon-sp-api",
    dataOrigin: "LIVE_AMAZON",
    marketplaceId: input.marketplace.marketplaceId,
    checkedAt,
    probeAsinCount: asins.length,
    operations,
    capabilities: (
      ["CATALOG", "COMPETITIVE_OFFERS", "FEES", "RESTRICTIONS"] as const
    ).map((capability) => aggregate(capability, operations, checkedAt)),
  };
}
