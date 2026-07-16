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
} from "./connectivity.js";

export * from "./connectivity.js";

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

  constructor(
    private readonly config: SpApiConfig,
    private readonly accessToken: AccessTokenSupplier,
  ) {
    this.transport = new SpApiTransport(config, accessToken);
  }

  private async request(
    path: string,
    init: RequestInit = {},
  ): Promise<{ body: unknown; observedAt: string; requestId?: string }> {
    return this.transport.request(path, init);
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
      value: pricing.value.lowestPrice
        ? [
            {
              sellerId: "amazon-aggregate",
              price: pricing.value.lowestPrice,
              currency: pricing.value.currency,
            },
          ]
        : [],
      provenance: pricing.provenance,
    });
  }

  async getCompetitivePricing(
    asin: string,
    marketplace: MarketplaceContext,
  ): Promise<CompetitivePricing> {
    const result = await this.request(
      "/batches/products/pricing/2022-05-01/items/competitiveSummary",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          requests: [
            {
              asin,
              marketplaceId: marketplace.marketplaceId,
              method: "GET",
              uri: `/products/pricing/2022-05-01/items/${asin}/competitiveSummary`,
              includedData: ["featuredBuyingOptions", "lowestPricedOffers"],
            },
          ],
        }),
      },
    );
    const body = result.body as {
      responses?: Array<{ body?: { payload?: Record<string, unknown> } }>;
    };
    const payload = body.responses?.[0]?.body?.payload ?? {};
    const offers = Array.isArray(payload.lowestPricedOffers)
      ? (payload.lowestPricedOffers as Array<Record<string, unknown>>)
      : [];
    const firstOffer = offers[0];
    const listingPrice = firstOffer?.listingPrice as
      { amount?: string; currencyCode?: string } | undefined;
    if (!listingPrice?.amount || !listingPrice.currencyCode)
      throw new ProviderError("INVALID_RESPONSE");
    return competitivePricingSchema.parse({
      value: {
        currency: listingPrice.currencyCode,
        lowestPrice: listingPrice.amount,
        offerCount: offers.length,
      },
      provenance: {
        provider: "amazon-sp-api",
        observedAt: result.observedAt,
        freshnessState: "FRESH",
        providerReference: result.requestId ?? asin,
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
