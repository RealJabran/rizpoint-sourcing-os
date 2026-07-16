import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
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
export * from "./offer-policy.js";
import { amazonRetailPresence } from "./offer-policy.js";

export type EncryptedSecret = {
  ciphertext: string;
  nonce: string;
  tag: string;
  keyVersion: number;
};

export class CredentialVault {
  constructor(
    private readonly keys: ReadonlyMap<number, Buffer>,
    private readonly activeKeyVersion: number,
  ) {}

  encrypt(value: string, aad: string): EncryptedSecret {
    const key = this.keys.get(this.activeKeyVersion);
    if (!key || key.length !== 32)
      throw new Error("credential_encryption_key_missing");
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, nonce);
    cipher.setAAD(Buffer.from(aad));
    const ciphertext = Buffer.concat([
      cipher.update(value, "utf8"),
      cipher.final(),
    ]);
    return {
      ciphertext: ciphertext.toString("base64url"),
      nonce: nonce.toString("base64url"),
      tag: cipher.getAuthTag().toString("base64url"),
      keyVersion: this.activeKeyVersion,
    };
  }

  decrypt(value: EncryptedSecret, aad: string): string {
    const key = this.keys.get(value.keyVersion);
    if (!key || key.length !== 32)
      throw new Error("credential_encryption_key_unavailable");
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(value.nonce, "base64url"),
    );
    decipher.setAAD(Buffer.from(aad));
    decipher.setAuthTag(Buffer.from(value.tag, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(value.ciphertext, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  }
}

export function vaultFromEnvironment(): CredentialVault | null {
  const encoded = process.env.PROVIDER_CREDENTIAL_KEY_V1;
  if (!encoded) return null;
  const key = Buffer.from(encoded, "base64");
  return key.length === 32 ? new CredentialVault(new Map([[1, key]]), 1) : null;
}

export class AmazonSpApiProvider
  implements
    CatalogProvider,
    PricingProvider,
    FeeProvider,
    RestrictionProvider,
    MarketHistoryProvider,
    ProviderHealthProvider
{
  private readonly transport: SpApiTransport;
  private pricingRateLimitPerSecond = 0.033;
  private nextPricingRequestAt = 0;
  private pricingQueue: Promise<void> = Promise.resolve();

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
    const summary = Array.isArray(item.summaries)
      ? item.summaries[0]
      : undefined;
    const attributes = Array.isArray(item.attributes)
      ? item.attributes[0]
      : undefined;
    const source = {
      ...(summary && typeof summary === "object" ? summary : {}),
      ...(attributes && typeof attributes === "object" ? attributes : {}),
    } as Record<string, unknown>;
    const text = (...keys: string[]) => {
      for (const key of keys) {
        const value = source[key];
        if (typeof value === "string" && value.trim()) return value.trim();
        if (Array.isArray(value)) {
          const first = value[0] as
            Record<string, unknown> | string | undefined;
          if (typeof first === "string" && first.trim()) return first.trim();
          if (first && typeof first === "object") {
            const display = first.value ?? first.displayValue;
            if (typeof display === "string" && display.trim())
              return display.trim();
          }
        }
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
    const relationships = (
      Array.isArray(item.relationships) ? item.relationships : []
    )
      .flatMap((group) =>
        group &&
        typeof group === "object" &&
        Array.isArray((group as Record<string, unknown>).relationships)
          ? ((group as Record<string, unknown>).relationships as unknown[])
          : [],
      )
      .flatMap((relation) => {
        const value = relation as Record<string, unknown>;
        const type =
          typeof value.type === "string" ? value.type : "RELATIONSHIP";
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
    const dimension = Array.isArray(item.dimensions)
      ? item.dimensions[0]
      : undefined;
    const dimensionValue = (key: string) => {
      const value =
        dimension && typeof dimension === "object"
          ? (dimension as Record<string, unknown>)[key]
          : undefined;
      if (!value || typeof value !== "object") return undefined;
      const amount = (value as Record<string, unknown>).value;
      return typeof amount === "number" || typeof amount === "string"
        ? String(amount)
        : undefined;
    };
    const dimensionUnit =
      dimension && typeof dimension === "object"
        ? (dimension as Record<string, unknown>).unitOfMeasure
        : undefined;
    const expected = [
      "summaries",
      "identifiers",
      "attributes",
      "images",
      "relationships",
    ];
    const completeness = expected.every((key) => Array.isArray(item[key]))
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
      variationTheme: text("variationTheme"),
      productTypes: (Array.isArray(item.productTypes)
        ? item.productTypes
        : []
      ).flatMap((entry) => {
        const value = entry as Record<string, unknown>;
        return typeof value.productType === "string" ? [value.productType] : [];
      }),
      packageHierarchy: relationships,
      images,
      dimensions: {
        ...(dimensionValue("height")
          ? { height: dimensionValue("height") }
          : {}),
        ...(dimensionValue("length")
          ? { length: dimensionValue("length") }
          : {}),
        ...(dimensionValue("width") ? { width: dimensionValue("width") } : {}),
        ...(dimensionValue("weight")
          ? { weight: dimensionValue("weight") }
          : {}),
        ...(typeof dimensionUnit === "string" ? { unit: dimensionUnit } : {}),
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
              uri: `/products/pricing/2022-05-01/items/${asin}/competitiveSummary`,
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
    const result = await this.request(
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
                Amount: request.price,
              },
              Shipping: { CurrencyCode: request.currency, Amount: "0" },
            },
            Identifier: request.requestId,
          },
        }),
      },
    );
    const body = result.body as {
      payload?: {
        FeesEstimateResult?: {
          FeesEstimate?: {
            TotalFeesEstimate?: { Amount?: string; CurrencyCode?: string };
          };
        };
      };
    };
    const fee =
      body.payload?.FeesEstimateResult?.FeesEstimate?.TotalFeesEstimate;
    if (!fee?.Amount || !fee.CurrencyCode)
      throw new ProviderError("INVALID_RESPONSE");
    return feeEstimateSchema.parse({
      value: {
        totalFee: fee.Amount,
        quotedPrice: request.price,
        currency: fee.CurrencyCode,
      },
      provenance: {
        provider: "amazon-sp-api",
        observedAt: result.observedAt,
        freshnessState: "FRESH",
        providerReference: result.requestId ?? request.requestId,
      },
    });
  }

  async getRestrictions(
    asin: string,
    marketplace: MarketplaceContext,
  ): Promise<Restrictions> {
    if (!marketplace.sellerId) throw new ProviderError("PERMANENT");
    const result = await this.request(
      `/listings/2021-08-01/restrictions?asin=${encodeURIComponent(asin)}&sellerId=${encodeURIComponent(marketplace.sellerId)}&marketplaceIds=${encodeURIComponent(marketplace.marketplaceId)}&conditionType=new_new`,
    );
    const restrictions =
      (result.body as { restrictions?: unknown[] }).restrictions ?? [];
    return restrictionsSchema.parse({
      value: {
        status: restrictions.length === 0 ? "ALLOWED" : "REQUIRES_APPROVAL",
      },
      provenance: {
        provider: "amazon-sp-api",
        observedAt: result.observedAt,
        freshnessState: "FRESH",
        providerReference: result.requestId ?? asin,
      },
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
      status:
        health.status === "CONNECTED"
          ? "HEALTHY"
          : health.status === "UNAUTHORIZED"
            ? "AUTH_REQUIRED"
            : health.status === "THROTTLED"
              ? "DEGRADED"
              : "UNAVAILABLE",
      checkedAt: health.checkedAt,
      ...(health.lastErrorCode ? { lastErrorCode: health.lastErrorCode } : {}),
    };
  }
}
