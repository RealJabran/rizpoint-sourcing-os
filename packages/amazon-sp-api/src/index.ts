import {
  catalogProductSchema,
  competitivePricingSchema,
  currentOffersSchema,
  feeEstimateSchema,
  type CatalogIdentifier,
  type CatalogProduct,
  type CatalogProvider,
  type CompetitivePricing,
  type CompetitivePricingBatchResult,
  type CurrentOffers,
  type FeeEstimate,
  type FeeEstimateRequest,
  type FeeProvider,
  type MarketHistory,
  type MarketHistoryProvider,
  type MarketplaceContext,
  type PricingProvider,
  type ProviderCapabilityDiscovery,
  type ProviderCapabilityState,
  ProviderError,
  type ProviderHealth,
  type ProviderHealthProvider,
  type RestrictionProvider,
  type Restrictions,
  restrictionsSchema,
} from "@rizpoint/provider-contracts";
import {
  SpApiTransport,
  testSpApiConnection,
  type AccessTokenSupplier,
  type SpApiConfig,
  type SpApiResponse,
} from "./connectivity.js";

export * from "./connectivity.js";
export * from "./credential-vault.js";
export * from "./oauth.js";
export * from "./fee-normalizer.js";
export * from "./offer-policy.js";
import { amazonRetailPresence } from "./offer-policy.js";
import {
  normalizeFeeComponents,
  providerMoney,
  type ProviderMoney,
} from "./fee-normalizer.js";
import { restrictionReasonCodes } from "./restriction-policy.js";

export class AmazonSpApiProvider
  implements
    CatalogProvider,
    PricingProvider,
    FeeProvider,
    RestrictionProvider,
    MarketHistoryProvider,
    ProviderHealthProvider,
    ProviderCapabilityDiscovery
{
  private readonly transport: SpApiTransport;
  private pricingRateLimitPerSecond = 0.033;
  private nextPricingRequestAt = 0;
  private pricingQueue: Promise<void> = Promise.resolve();
  private readonly operationLimits = {
    fees: { rate: 1, nextRequestAt: 0, queue: Promise.resolve() },
    restrictions: { rate: 5, nextRequestAt: 0, queue: Promise.resolve() },
  };

  constructor(
    private readonly config: SpApiConfig,
    private readonly accessToken: AccessTokenSupplier,
  ) {
    this.transport = new SpApiTransport(config, accessToken);
  }

  private async request(
    path: string,
    init: RequestInit = {},
  ): Promise<SpApiResponse> {
    return this.transport.request(path, init);
  }

  private async waitForPricingCapacity(): Promise<void> {
    const delay = this.nextPricingRequestAt - Date.now();
    if (delay > 0)
      await new Promise<void>((resolve) => setTimeout(resolve, delay));
  }

  private async rateLimitedRequest(
    operation: keyof typeof this.operationLimits,
    path: string,
    init: RequestInit = {},
  ): Promise<SpApiResponse> {
    const state = this.operationLimits[operation];
    let output: SpApiResponse | undefined;
    let failure: unknown;
    const task = state.queue.then(async () => {
      const delay = state.nextRequestAt - Date.now();
      if (delay > 0)
        await new Promise<void>((resolve) => setTimeout(resolve, delay));
      try {
        output = await this.request(path, init);
        if (
          output.rateLimitPerSecond !== undefined &&
          output.rateLimitPerSecond > 0
        )
          state.rate = output.rateLimitPerSecond;
      } catch (error) {
        failure = error;
      } finally {
        state.nextRequestAt = Date.now() + Math.ceil(1_000 / state.rate);
      }
    });
    state.queue = task.catch(() => undefined);
    await task;
    if (failure) throw failure;
    if (!output) throw new ProviderError("TRANSIENT");
    return output;
  }

  private catalogPath(query: Record<string, string>): string {
    return `/catalog/2022-04-01/items?${new URLSearchParams({
      ...query,
      includedData:
        "attributes,classifications,dimensions,identifiers,images,productTypes,salesRanks,summaries,relationships",
    }).toString()}`;
  }

  /** Normalize only documented Catalog Items fields. The original response is
   * carried separately for private persistence and is never a web DTO. */
  private catalogProduct(
    item: Record<string, unknown>,
    marketplace: MarketplaceContext,
    result: { body: unknown; observedAt: string; requestId?: string },
  ): CatalogProduct | null {
    const asin = typeof item.asin === "string" ? item.asin : null;
    if (!asin || !/^B[A-Z0-9]{9}$/.test(asin)) return null;
    const record = (value: unknown): Record<string, unknown> | undefined =>
      value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : undefined;
    const summary = Array.isArray(item.summaries)
      ? record(item.summaries[0])
      : undefined;
    // Catalog Items v2022-04-01 returns ItemAttributes as an object whose
    // product-type-specific keys hold arrays of marketplace values. It is not
    // an array of attribute objects. Keeping that shape here prevents valid
    // live observations from losing package/variation evidence or becoming
    // falsely PARTIAL.
    const attributes = record(item.attributes);
    const source = {
      ...summary,
      ...attributes,
    };
    const normalizedKey = (key: string) =>
      key.replace(/[^a-z0-9]/gi, "").toLowerCase();
    const sourceValue = (key: string) =>
      source[key] ??
      Object.entries(source).find(
        ([candidate]) => normalizedKey(candidate) === normalizedKey(key),
      )?.[1];
    const scalarText = (value: unknown): string | undefined => {
      if (typeof value === "string" && value.trim()) return value.trim();
      if (typeof value === "number" && Number.isFinite(value))
        return String(value);
      if (!Array.isArray(value)) return undefined;
      for (const entry of value) {
        if (typeof entry === "string" && entry.trim()) return entry.trim();
        if (typeof entry === "number" && Number.isFinite(entry))
          return String(entry);
        const entryRecord = record(entry);
        const display = entryRecord?.value ?? entryRecord?.displayValue;
        if (typeof display === "string" && display.trim())
          return display.trim();
        if (typeof display === "number" && Number.isFinite(display))
          return String(display);
      }
      return undefined;
    };
    const text = (...keys: string[]) => {
      for (const key of keys) {
        const value = scalarText(sourceValue(key));
        if (value) return value;
      }
      return undefined;
    };
    const count = text(
      "packageQuantity",
      "itemPackageQuantity",
      "numberOfItems",
    );
    const identifiers = (
      Array.isArray(item.identifiers) ? item.identifiers : []
    )
      .flatMap((group) =>
        group &&
        typeof group === "object" &&
        Array.isArray((group as Record<string, unknown>).identifiers)
          ? ((group as Record<string, unknown>).identifiers as unknown[])
          : [],
      )
      .flatMap((identifier) => {
        const value = identifier as Record<string, unknown>;
        const type =
          typeof value.identifierType === "string"
            ? value.identifierType.toUpperCase()
            : "";
        return ["ASIN", "UPC", "EAN", "GTIN", "MPN"].includes(type) &&
          typeof value.identifier === "string"
          ? [{ type, value: value.identifier }]
          : [];
      });
    const images = (Array.isArray(item.images) ? item.images : [])
      .flatMap((group) =>
        group &&
        typeof group === "object" &&
        Array.isArray((group as Record<string, unknown>).images)
          ? ((group as Record<string, unknown>).images as unknown[])
          : [],
      )
      .flatMap((image) => {
        const value = image as Record<string, unknown>;
        return typeof value.link === "string" && /^https:\/\//.test(value.link)
          ? [
              {
                url: value.link,
                ...(typeof value.variant === "string"
                  ? { variant: value.variant }
                  : {}),
                ...(typeof value.height === "number"
                  ? { height: value.height }
                  : {}),
                ...(typeof value.width === "number"
                  ? { width: value.width }
                  : {}),
              },
            ]
          : [];
      });
    const relationshipDetails = (
      Array.isArray(item.relationships) ? item.relationships : []
    ).flatMap((group) =>
      group &&
      typeof group === "object" &&
      Array.isArray((group as Record<string, unknown>).relationships)
        ? ((group as Record<string, unknown>).relationships as unknown[])
        : [],
    );
    const relationshipVariationTheme = relationshipDetails
      .map((relation) => record(record(relation)?.variationTheme)?.theme)
      .find((theme): theme is string => typeof theme === "string" && !!theme);
    const packageHierarchy = relationshipDetails.flatMap((relation) => {
      const value = relation as Record<string, unknown>;
      const type = typeof value.type === "string" ? value.type : "RELATIONSHIP";
      return ["parentAsins", "childAsins"].flatMap((key) =>
        Array.isArray(value[key])
          ? (value[key] as unknown[]).flatMap((related) =>
              typeof related === "string" && /^B[A-Z0-9]{9}$/.test(related)
                ? [{ type, asin: related }]
                : [],
            )
          : [],
      );
    });
    const dimensionByMarketplace = Array.isArray(item.dimensions)
      ? record(item.dimensions[0])
      : undefined;
    // DimensionsByMarketplace nests physical dimensions under `package` and
    // `item`. Prefer package dimensions because they describe the sellable
    // Amazon package; preserve the legacy direct shape for recorded fixtures.
    const dimension =
      record(dimensionByMarketplace?.package) ??
      record(dimensionByMarketplace?.item) ??
      dimensionByMarketplace;
    const dimensionValue = (key: string) => {
      const source = record(dimension?.[key]);
      const amount = source?.value;
      const unit =
        typeof source?.unit === "string"
          ? source.unit
          : // This fallback keeps legacy recorded fixtures resumable. Live
            // Catalog Items v2022-04-01 projections use the documented `unit`.
            typeof source?.unitOfMeasure === "string"
            ? source.unitOfMeasure
            : undefined;
      return (typeof amount === "number" || typeof amount === "string") && unit
        ? { value: String(amount), unit }
        : undefined;
    };
    const height = dimensionValue("height");
    const length = dimensionValue("length");
    const width = dimensionValue("width");
    const weight = dimensionValue("weight");
    const expected = [
      "summaries",
      "identifiers",
      "attributes",
      "images",
      "relationships",
    ];
    const completeness = expected.every((key) =>
      key === "attributes"
        ? attributes !== undefined
        : Array.isArray(item[key]),
    )
      ? "COMPLETE"
      : "PARTIAL";
    return catalogProductSchema.parse({
      asin,
      title: text("itemName", "productDescription", "title") ?? asin,
      brand: text("brandName", "brand"),
      manufacturer: text("manufacturer", "manufacturerName"),
      model: text("modelNumber", "model"),
      mpn: text("partNumber", "manufacturerPartNumber"),
      sizeText: text("sizeName", "size"),
      color: text("colorName", "color"),
      packCount:
        count && /^\d+$/.test(count) && Number(count) > 0
          ? Number(count)
          : undefined,
      variation: text("styleName"),
      variationTheme: text("variationTheme") ?? relationshipVariationTheme,
      productTypes: (Array.isArray(item.productTypes)
        ? item.productTypes
        : []
      ).flatMap((entry) => {
        const value = entry as Record<string, unknown>;
        return typeof value.productType === "string" ? [value.productType] : [];
      }),
      packageHierarchy,
      images,
      dimensions: {
        ...(height ? { height } : {}),
        ...(length ? { length } : {}),
        ...(width ? { width } : {}),
        ...(weight ? { weight } : {}),
      },
      identifiers,
      salesRanks: (Array.isArray(item.salesRanks)
        ? item.salesRanks
        : []
      ).flatMap((rank) => {
        const value = rank as Record<string, unknown>;
        return typeof value.classificationId === "string" &&
          typeof value.rank === "number" &&
          value.rank > 0
          ? [{ classificationId: value.classificationId, rank: value.rank }]
          : [];
      }),
      provenance: {
        provider: "amazon-sp-api",
        observedAt: result.observedAt,
        freshnessState: "FRESH",
        providerReference: asin,
        marketplaceId: marketplace.marketplaceId,
        requestId: result.requestId,
        responseCompleteness: completeness,
      },
      rawProviderObservation: result.body,
    });
  }

  async getItem(
    asin: string,
    marketplace?: MarketplaceContext,
  ): Promise<CatalogProduct | null> {
    if (!marketplace) throw new ProviderError("PERMANENT");
    const result = await this.request(
      `/catalog/2022-04-01/items/${encodeURIComponent(asin)}?${new URLSearchParams({ marketplaceIds: marketplace.marketplaceId, includedData: "attributes,classifications,dimensions,identifiers,images,productTypes,salesRanks,summaries,relationships" }).toString()}`,
    );
    return this.catalogProduct(
      { ...(result.body as Record<string, unknown>), asin },
      marketplace,
      result,
    );
  }

  async searchByIdentifier(
    identifier: CatalogIdentifier,
    marketplace?: MarketplaceContext,
  ): Promise<readonly CatalogProduct[]> {
    return this.searchByIdentifiers([identifier], marketplace);
  }

  async searchByIdentifiers(
    identifiers: readonly CatalogIdentifier[],
    marketplace?: MarketplaceContext,
  ): Promise<readonly CatalogProduct[]> {
    if (!marketplace) throw new ProviderError("PERMANENT");
    if (!identifiers.length) return [];
    if (identifiers.length > 20) throw new ProviderError("INVALID_REQUEST");
    const type = identifiers[0]?.type;
    if (
      !type ||
      !["UPC", "EAN", "GTIN", "ASIN"].includes(type) ||
      identifiers.some((item) => item.type !== type)
    )
      throw new ProviderError("INVALID_REQUEST");
    const result = await this.request(
      this.catalogPath({
        marketplaceIds: marketplace.marketplaceId,
        identifiers: identifiers.map((item) => item.value).join(","),
        identifiersType: type,
      }),
    );
    return ((result.body as { items?: unknown[] }).items ?? []).flatMap(
      (item) =>
        item && typeof item === "object"
          ? [
              this.catalogProduct(
                item as Record<string, unknown>,
                marketplace,
                result,
              ),
            ].filter((product): product is CatalogProduct => product !== null)
          : [],
    );
  }

  async searchByKeywords(
    keywords: string,
    marketplace?: MarketplaceContext,
  ): Promise<readonly CatalogProduct[]> {
    if (!marketplace) throw new ProviderError("PERMANENT");
    const result = await this.request(
      this.catalogPath({ marketplaceIds: marketplace.marketplaceId, keywords }),
    );
    return ((result.body as { items?: unknown[] }).items ?? []).flatMap(
      (item) =>
        item && typeof item === "object"
          ? [
              this.catalogProduct(
                item as Record<string, unknown>,
                marketplace,
                result,
              ),
            ].filter((product): product is CatalogProduct => product !== null)
          : [],
    );
  }

  async getCurrentOffers(
    asin: string,
    marketplace: MarketplaceContext,
  ): Promise<CurrentOffers> {
    const pricing = await this.getCompetitivePricing(asin, marketplace);
    return currentOffersSchema.parse({
      value: pricing.value.offers.flatMap((offer) =>
        offer.sellerId && offer.landedPrice && offer.currency
          ? [
              {
                sellerId: offer.sellerId,
                price: offer.landedPrice,
                currency: offer.currency,
              },
            ]
          : [],
      ),
      provenance: pricing.provenance,
    });
  }

  async getCompetitivePricing(
    asin: string,
    marketplace: MarketplaceContext,
  ): Promise<CompetitivePricing> {
    const [result] = await this.getCompetitivePricingBatch([asin], marketplace);
    if (!result) throw new ProviderError("INVALID_RESPONSE");
    if (result.status === "ERROR")
      throw new ProviderError(result.error.code, result.error);
    return result.pricing;
  }

  async getCompetitivePricingBatch(
    asins: readonly string[],
    marketplace: MarketplaceContext,
  ): Promise<readonly CompetitivePricingBatchResult[]> {
    const uniqueAsins = [...new Set(asins)];
    if (
      uniqueAsins.length !== asins.length ||
      uniqueAsins.length < 1 ||
      uniqueAsins.length > 20 ||
      uniqueAsins.some((asin) => !/^B[A-Z0-9]{9}$/.test(asin))
    )
      throw new ProviderError("INVALID_REQUEST");
    const previous = this.pricingQueue;
    let releaseQueue!: () => void;
    this.pricingQueue = new Promise<void>((resolve) => {
      releaseQueue = resolve;
    });
    await previous;
    let result: SpApiResponse;
    try {
      await this.waitForPricingCapacity();
      result = await this.request(
        "/batches/products/pricing/2022-05-01/items/competitiveSummary",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            requests: uniqueAsins.map((asin) => ({
              asin,
              marketplaceId: marketplace.marketplaceId,
              method: "GET",
              uri: "/products/pricing/2022-05-01/items/competitiveSummary",
              includedData: ["featuredBuyingOptions", "lowestPricedOffers"],
              lowestPricedOffersInputs: [
                { itemCondition: "New", offerType: "Consumer" },
              ],
            })),
          }),
        },
      );
      if (
        result.rateLimitPerSecond !== undefined &&
        result.rateLimitPerSecond > 0
      )
        this.pricingRateLimitPerSecond = result.rateLimitPerSecond;
      this.nextPricingRequestAt =
        Date.now() + Math.ceil(1_000 / this.pricingRateLimitPerSecond);
    } finally {
      releaseQueue();
    }
    const body = result.body as {
      responses?: Array<{
        status?: { statusCode?: number };
        body?: Record<string, unknown>;
      }>;
    };
    const responses = body.responses;
    if (!Array.isArray(responses) || responses.length !== uniqueAsins.length)
      throw new ProviderError("INVALID_RESPONSE");
    return uniqueAsins.map((asin, index) => {
      const response =
        responses.find((candidate) => candidate.body?.asin === asin) ??
        responses[index];
      if (!response) throw new ProviderError("INVALID_RESPONSE");
      try {
        return {
          asin,
          status: "SUCCESS" as const,
          pricing: this.parseCompetitivePricingResponse(
            asin,
            marketplace,
            response,
            result,
          ),
        };
      } catch (error) {
        const providerError =
          error instanceof ProviderError
            ? error
            : new ProviderError("INVALID_RESPONSE");
        return {
          asin,
          status: "ERROR" as const,
          error: { code: providerError.code, ...providerError.options },
        };
      }
    });
  }

  private parseCompetitivePricingResponse(
    asin: string,
    marketplace: MarketplaceContext,
    response: {
      status?: { statusCode?: number };
      body?: Record<string, unknown>;
    },
    result: SpApiResponse,
  ): CompetitivePricing {
    const statusCode = response?.status?.statusCode;
    if (statusCode && statusCode !== 200) {
      const code =
        statusCode === 401
          ? "UNAUTHORIZED"
          : statusCode === 403
            ? "FORBIDDEN"
            : statusCode === 429
              ? "THROTTLED"
              : statusCode >= 500
                ? "PROVIDER_OUTAGE"
                : "INVALID_RESPONSE";
      throw new ProviderError(code, { httpStatus: statusCode });
    }
    const payload = response?.body ?? {};
    const money = (value: unknown): { amount?: string; currency?: string } => {
      const record = value as
        { amount?: unknown; currencyCode?: unknown } | undefined;
      return record &&
        (typeof record.amount === "string" || typeof record.amount === "number")
        ? {
            amount: String(record.amount),
            ...(typeof record.currencyCode === "string"
              ? { currency: record.currencyCode }
              : {}),
          }
        : {};
    };
    const addMoney = (left?: string, right?: string): string | undefined => {
      if (!left) return undefined;
      if (!right) return left;
      const parts = [left, right].map((value) => {
        const [whole = "0", fraction = ""] = value.split(".");
        return { whole, fraction };
      });
      const scale = Math.max(...parts.map(({ fraction }) => fraction.length));
      const integers = parts.map(({ whole, fraction }) =>
        BigInt(`${whole}${fraction.padEnd(scale, "0")}`),
      );
      const total = integers[0]! + integers[1]!;
      if (scale === 0) return total.toString();
      const padded = total.toString().padStart(scale + 1, "0");
      return `${padded.slice(0, -scale)}.${padded.slice(-scale)}`;
    };
    const normalizeOffer = (
      offer: Record<string, unknown>,
      isFeatured: boolean,
    ) => {
      const listing = money(offer.listingPrice);
      const shippingOptions = Array.isArray(offer.shippingOptions)
        ? (offer.shippingOptions as Array<Record<string, unknown>>)
        : [];
      const preferredShipping =
        shippingOptions.find(
          (option) => option.shippingOptionType === "DEFAULT",
        ) ?? shippingOptions[0];
      const shipping = money(preferredShipping?.price);
      const sameCurrency =
        !shipping.currency ||
        !listing.currency ||
        shipping.currency === listing.currency;
      const landedAmount = sameCurrency
        ? addMoney(listing.amount, shipping.amount)
        : undefined;
      const fulfillment =
        typeof offer.fulfillmentType === "string"
          ? offer.fulfillmentType === "AFN"
            ? "AMAZON"
            : offer.fulfillmentType === "MFN"
              ? "MERCHANT"
              : "UNKNOWN"
          : "UNKNOWN";
      const segments = Array.isArray(offer.featuredOfferSegments)
        ? (offer.featuredOfferSegments as Array<Record<string, unknown>>)
        : [];
      return {
        ...(typeof offer.sellerId === "string"
          ? { sellerId: offer.sellerId }
          : {}),
        ...(typeof offer.condition === "string"
          ? { condition: offer.condition }
          : {}),
        fulfillmentChannel: fulfillment,
        ...(listing.amount ? { listingPrice: listing.amount } : {}),
        ...(shipping.amount ? { shippingPrice: shipping.amount } : {}),
        ...(landedAmount ? { landedPrice: landedAmount } : {}),
        ...(listing.currency ? { currency: listing.currency } : {}),
        memberships: segments.flatMap<"PRIME" | "NON_PRIME" | "DEFAULT">(
          (segment) => {
            const membership = segment.customerMembership;
            return membership === "PRIME" ||
              membership === "NON_PRIME" ||
              membership === "DEFAULT"
              ? [membership]
              : [];
          },
        ),
        isFeatured,
        _currencyMismatch: !sameCurrency,
      } as const;
    };
    const featuredOptions = Array.isArray(payload.featuredBuyingOptions)
      ? (payload.featuredBuyingOptions as Array<Record<string, unknown>>)
      : null;
    const featured =
      featuredOptions?.flatMap((option) =>
        Array.isArray(option.segmentedFeaturedOffers)
          ? (option.segmentedFeaturedOffers as Array<Record<string, unknown>>)
          : [],
      ) ?? [];
    const lowestGroups = Array.isArray(payload.lowestPricedOffers)
      ? (payload.lowestPricedOffers as Array<Record<string, unknown>>)
      : null;
    const lowestOffers =
      lowestGroups?.flatMap((group) =>
        Array.isArray(group.offers)
          ? (group.offers as Array<Record<string, unknown>>)
          : [],
      ) ?? [];
    const normalizedFeatured = featured.map((offer) =>
      normalizeOffer(offer, true),
    );
    const normalizedLowest = lowestOffers.map((offer) =>
      normalizeOffer(offer, false),
    );
    const normalized = [...normalizedFeatured, ...normalizedLowest].filter(
      (offer, index, values) =>
        values.findIndex(
          (candidate) =>
            candidate.sellerId === offer.sellerId &&
            candidate.fulfillmentChannel === offer.fulfillmentChannel &&
            candidate.landedPrice === offer.landedPrice &&
            candidate.isFeatured === offer.isFeatured,
        ) === index,
    );
    const values = (channel: "AMAZON" | "MERCHANT") =>
      normalized
        .filter((offer) => offer.fulfillmentChannel === channel)
        .flatMap((offer) =>
          (offer.landedPrice ?? offer.listingPrice)
            ? [offer.landedPrice ?? offer.listingPrice!]
            : [],
        );
    const decimalOrder = (left: string, right: string) => {
      const normalize = (value: string) => {
        const [whole = "0", fraction = ""] = value.split(".");
        return { whole, fraction };
      };
      const a = normalize(left);
      const b = normalize(right);
      const scale = Math.max(a.fraction.length, b.fraction.length);
      const ai = BigInt(`${a.whole}${a.fraction.padEnd(scale, "0")}`);
      const bi = BigInt(`${b.whole}${b.fraction.padEnd(scale, "0")}`);
      return ai < bi ? -1 : ai > bi ? 1 : 0;
    };
    const lowest = (priceValues: readonly string[]) =>
      [...priceValues].sort(decimalOrder)[0];
    if (
      (typeof payload.asin === "string" && payload.asin !== asin) ||
      (typeof payload.marketplaceId === "string" &&
        payload.marketplaceId !== marketplace.marketplaceId)
    )
      throw new ProviderError("INVALID_RESPONSE");
    const complete =
      featuredOptions !== null &&
      lowestGroups !== null &&
      !normalized.some((offer) => offer._currencyMismatch);
    const featuredOffer =
      normalizedFeatured.find((offer) =>
        offer.memberships.includes("DEFAULT"),
      ) ?? normalizedFeatured[0];
    const countCompleteness = lowestGroups === null ? "UNKNOWN" : "PARTIAL";
    const count = (offers: typeof normalizedLowest) => ({
      ...(lowestGroups !== null ? { value: offers.length } : {}),
      completeness: countCompleteness,
    });
    const fba = normalizedLowest.filter(
      (offer) => offer.fulfillmentChannel === "AMAZON",
    );
    const fbm = normalizedLowest.filter(
      (offer) => offer.fulfillmentChannel === "MERCHANT",
    );
    return competitivePricingSchema.parse({
      value: {
        operation: "getCompetitiveSummary",
        asin,
        marketplaceId: marketplace.marketplaceId,
        ...(featuredOffer?.currency
          ? { currency: featuredOffer.currency }
          : {}),
        ...(featuredOffer?.landedPrice
          ? { buyBoxPrice: featuredOffer.landedPrice }
          : {}),
        ...(lowest(
          normalized.flatMap((offer) =>
            (offer.landedPrice ?? offer.listingPrice)
              ? [offer.landedPrice ?? offer.listingPrice!]
              : [],
          ),
        )
          ? {
              lowestPrice: lowest(
                normalized.flatMap((offer) =>
                  (offer.landedPrice ?? offer.listingPrice)
                    ? [offer.landedPrice ?? offer.listingPrice!]
                    : [],
                ),
              ),
            }
          : {}),
        featuredOfferState: normalizedFeatured.length
          ? "PRESENT"
          : featuredOptions !== null
            ? "ABSENT"
            : "UNKNOWN",
        ...(featuredOffer ? { featuredOffer } : {}),
        completeness: complete ? "COMPLETE" : "PARTIAL",
        totalVisibleOffers: count(normalizedLowest),
        fbaVisibleOffers: count(fba),
        fbmVisibleOffers: count(fbm),
        ...(lowestGroups !== null
          ? {
              visibleOfferCount: normalizedLowest.length,
              offerCount: normalizedLowest.length,
              fbaOfferCount: fba.length,
              fbmOfferCount: fbm.length,
            }
          : {}),
        amazonRetailPresence: amazonRetailPresence(
          marketplace.marketplaceId,
          normalized.map((offer) => offer.sellerId),
          countCompleteness,
        ),
        brandSellerStatus: "UNKNOWN",
        ...(lowest(values("AMAZON"))
          ? { lowestFbaPrice: lowest(values("AMAZON")) }
          : {}),
        ...(lowest(values("MERCHANT"))
          ? { lowestFbmPrice: lowest(values("MERCHANT")) }
          : {}),
        offers: normalized,
      },
      provenance: {
        provider: "amazon-sp-api",
        observedAt: result.observedAt,
        freshnessState: "FRESH",
        providerReference: asin,
        marketplaceId: marketplace.marketplaceId,
        requestId: result.requestId,
        responseCompleteness: complete ? "COMPLETE" : "PARTIAL",
      },
      rawProviderObservation: {
        status: response.status,
        body: response.body,
      },
    });
  }

  async estimateFees(request: FeeEstimateRequest): Promise<FeeEstimate> {
    const result = await this.rateLimitedRequest(
      "fees",
      `/products/fees/v0/items/${encodeURIComponent(request.asin)}/feesEstimate`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          FeesEstimateRequest: {
            MarketplaceId: request.marketplace.marketplaceId,
            IsAmazonFulfilled: request.fulfillmentChannel === "AMAZON",
            PriceToEstimateFees: {
              ListingPrice: {
                CurrencyCode: request.currency,
                Amount: request.listingPrice ?? request.price,
              },
              Shipping: {
                CurrencyCode: request.currency,
                Amount: request.shippingPrice,
              },
            },
            Identifier: request.requestId,
          },
        }),
      },
    );
    const body = result.body as {
      payload?: {
        FeesEstimateResult?: {
          Status?: unknown;
          FeesEstimateIdentifier?: {
            MarketplaceId?: unknown;
            IdValue?: unknown;
            SellerInputIdentifier?: unknown;
            IsAmazonFulfilled?: unknown;
          };
          FeesEstimate?: {
            TimeOfFeesEstimation?: unknown;
            TotalFeesEstimate?: ProviderMoney;
            FeeDetailList?: unknown;
          };
          Error?: { Code?: unknown; Message?: unknown };
        };
      };
    };
    const estimateResult = body.payload?.FeesEstimateResult;
    if (!estimateResult) throw new ProviderError("INVALID_RESPONSE");
    if (estimateResult.Status === "ClientError")
      throw new ProviderError("INVALID_REQUEST");
    if (estimateResult.Status === "ServiceError")
      throw new ProviderError("PROVIDER_OUTAGE");
    if (estimateResult.Status !== "Success")
      throw new ProviderError("INVALID_RESPONSE");
    const estimate = estimateResult.FeesEstimate;
    const total = providerMoney(estimate?.TotalFeesEstimate);
    if (!total) throw new ProviderError("INVALID_RESPONSE");
    const normalized = normalizeFeeComponents(estimate?.FeeDetailList);
    const identifier = estimateResult.FeesEstimateIdentifier;
    const identifierComplete =
      identifier?.MarketplaceId === request.marketplace.marketplaceId &&
      identifier.IdValue === request.asin &&
      identifier.SellerInputIdentifier === request.requestId &&
      identifier.IsAmazonFulfilled ===
        (request.fulfillmentChannel === "AMAZON");
    // An absent or empty detail list cannot support component-audited profit,
    // even when Amazon provides an aggregate total (including its static sandbox).
    const complete =
      identifierComplete &&
      normalized.complete &&
      normalized.components.length > 0;
    return feeEstimateSchema.parse({
      value: {
        operation: "getMyFeesEstimateForASIN",
        asin: request.asin,
        marketplaceId: request.marketplace.marketplaceId,
        totalFee: total.amount,
        quotedPrice: request.price,
        listingPrice: request.listingPrice ?? request.price,
        shippingPrice: request.shippingPrice,
        currency: total.currency,
        fulfillmentChannel: request.fulfillmentChannel,
        scenarioSource: request.scenarioSource,
        completeness: complete ? "COMPLETE" : "PARTIAL",
        components: normalized.components,
      },
      provenance: {
        provider: "amazon-sp-api",
        observedAt: result.observedAt,
        freshnessState: "FRESH",
        providerReference: result.requestId ?? request.requestId,
        marketplaceId: request.marketplace.marketplaceId,
        requestId: result.requestId,
        responseCompleteness: complete ? "COMPLETE" : "PARTIAL",
      },
      rawProviderObservation: result.body,
    });
  }

  async getRestrictions(
    asin: string,
    marketplace: MarketplaceContext,
  ): Promise<Restrictions> {
    if (!marketplace.sellerId) throw new ProviderError("PERMANENT");
    const result = await this.rateLimitedRequest(
      "restrictions",
      `/listings/2021-08-01/restrictions?asin=${encodeURIComponent(asin)}&sellerId=${encodeURIComponent(marketplace.sellerId)}&marketplaceIds=${encodeURIComponent(marketplace.marketplaceId)}&conditionType=new_new`,
    );
    const response = result.body as { restrictions?: unknown };
    if (!Array.isArray(response.restrictions))
      throw new ProviderError("INVALID_RESPONSE");
    const normalizedReasons: Array<{
      code: "APPROVAL_REQUIRED" | "ASIN_NOT_FOUND" | "NOT_ELIGIBLE";
      message: string;
      links: Array<{
        resource: string;
        verb?: string;
        title?: string;
        type?: string;
      }>;
    }> = [];
    let complete = true;
    for (const restriction of response.restrictions) {
      if (!restriction || typeof restriction !== "object") {
        complete = false;
        continue;
      }
      const entry = restriction as Record<string, unknown>;
      if (entry.marketplaceId !== marketplace.marketplaceId) complete = false;
      if (!Array.isArray(entry.reasons) || entry.reasons.length === 0) {
        complete = false;
        continue;
      }
      for (const reason of entry.reasons) {
        if (!reason || typeof reason !== "object") {
          complete = false;
          continue;
        }
        const value = reason as Record<string, unknown>;
        if (
          typeof value.reasonCode !== "string" ||
          !restrictionReasonCodes.has(value.reasonCode) ||
          typeof value.message !== "string" ||
          value.message.length === 0
        ) {
          complete = false;
          continue;
        }
        const links = Array.isArray(value.links)
          ? value.links.flatMap((link) => {
              if (!link || typeof link !== "object") return [];
              const candidate = link as Record<string, unknown>;
              if (typeof candidate.resource !== "string") return [];
              try {
                new URL(candidate.resource);
              } catch {
                return [];
              }
              return [
                {
                  resource: candidate.resource,
                  ...(typeof candidate.verb === "string"
                    ? { verb: candidate.verb }
                    : {}),
                  ...(typeof candidate.title === "string"
                    ? { title: candidate.title }
                    : {}),
                  ...(typeof candidate.type === "string"
                    ? { type: candidate.type }
                    : {}),
                },
              ];
            })
          : [];
        normalizedReasons.push({
          code: value.reasonCode as
            "APPROVAL_REQUIRED" | "ASIN_NOT_FOUND" | "NOT_ELIGIBLE",
          message: value.message,
          links,
        });
      }
    }
    const reasonCodes = new Set(normalizedReasons.map((reason) => reason.code));
    const state = !complete
      ? "INCOMPLETE"
      : response.restrictions.length === 0
        ? "ELIGIBLE"
        : reasonCodes.has("NOT_ELIGIBLE")
          ? "RESTRICTED"
          : reasonCodes.has("APPROVAL_REQUIRED")
            ? "APPROVAL_REQUIRED"
            : "INCOMPLETE";
    return restrictionsSchema.parse({
      value: {
        operation: "getListingsRestrictions",
        asin,
        marketplaceId: marketplace.marketplaceId,
        state,
        completeness:
          complete && state !== "INCOMPLETE" ? "COMPLETE" : "PARTIAL",
        conditionType: "new_new",
        reasons: normalizedReasons,
      },
      provenance: {
        provider: "amazon-sp-api",
        observedAt: result.observedAt,
        freshnessState: "FRESH",
        providerReference: result.requestId ?? asin,
        marketplaceId: marketplace.marketplaceId,
        requestId: result.requestId,
        responseCompleteness:
          complete && state !== "INCOMPLETE" ? "COMPLETE" : "PARTIAL",
      },
      rawProviderObservation: result.body,
    });
  }

  async getHistory(
    _asin: string,
    _marketplace: MarketplaceContext,
  ): Promise<MarketHistory> {
    void _asin;
    void _marketplace;
    throw new ProviderError("PERMANENT");
  }

  async health(marketplace?: MarketplaceContext): Promise<ProviderHealth> {
    void marketplace;
    const health = await testSpApiConnection(this.transport);
    return {
      provider: health.provider,
      mode: "LIVE",
      status:
        health.status === "CONNECTED"
          ? "HEALTHY"
          : health.status === "UNAUTHORIZED"
            ? "UNAUTHORIZED"
            : health.status === "THROTTLED"
              ? "THROTTLED"
              : "UNAVAILABLE",
      checkedAt: health.checkedAt,
      ...(health.lastErrorCode ? { lastErrorCode: health.lastErrorCode } : {}),
      capabilities: [],
    };
  }

  async capabilities(
    marketplace: MarketplaceContext,
  ): Promise<readonly ProviderCapabilityState[]> {
    const health = await this.health(marketplace);
    const reason =
      health.status === "UNAUTHORIZED"
        ? ("CONNECTION_NOT_AUTHORIZED" as const)
        : health.status === "THROTTLED"
          ? ("PROVIDER_THROTTLED" as const)
          : health.status === "UNAVAILABLE"
            ? ("PROVIDER_OUTAGE" as const)
            : undefined;
    return (
      ["CATALOG", "COMPETITIVE_OFFERS", "FEES", "RESTRICTIONS"] as const
    ).map((capability) => ({
      providerKey: "amazon-sp-api",
      marketplaceId: marketplace.marketplaceId,
      capability,
      mode: "LIVE",
      state: health.status,
      checkedAt: health.checkedAt,
      completeness: health.status === "HEALTHY" ? "COMPLETE" : "UNKNOWN",
      ...(reason ? { reason } : {}),
    }));
  }
}
