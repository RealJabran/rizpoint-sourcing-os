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

  async getItem(
    asin: string,
    marketplace?: MarketplaceContext,
  ): Promise<CatalogProduct | null> {
    if (!marketplace) throw new ProviderError("PERMANENT");
    const result = await this.request(
      `/catalog/2022-04-01/items/${encodeURIComponent(asin)}?marketplaceIds=${encodeURIComponent(marketplace.marketplaceId)}&includedData=summaries,identifiers,salesRanks,dimensions`,
    );
    const body = result.body as {
      summaries?: Array<Record<string, unknown>>;
      identifiers?: Array<{
        identifiers?: Array<{ identifierType?: string; identifier?: string }>;
      }>;
      salesRanks?: Array<{ classificationId?: string; rank?: number }>;
      dimensions?: Array<Record<string, unknown>>;
    };
    const summary = body.summaries?.[0];
    const identifiers =
      body.identifiers
        ?.flatMap((group) => group.identifiers ?? [])
        .flatMap((identifier) => {
          const type = identifier.identifierType?.toUpperCase();
          return type &&
            ["ASIN", "UPC", "EAN", "GTIN", "MPN"].includes(type) &&
            identifier.identifier
            ? [{ type, value: identifier.identifier }]
            : [];
        }) ?? [];
    return catalogProductSchema.parse({
      asin,
      title: typeof summary?.itemName === "string" ? summary.itemName : asin,
      brand: summary?.brandName,
      model: summary?.modelNumber,
      identifiers,
      salesRanks: body.salesRanks?.flatMap((rank) =>
        rank.classificationId && rank.rank
          ? [{ classificationId: rank.classificationId, rank: rank.rank }]
          : [],
      ),
      provenance: {
        provider: "amazon-sp-api",
        observedAt: result.observedAt,
        freshnessState: "FRESH",
        providerReference: result.requestId ?? asin,
      },
    });
  }

  async searchByIdentifier(
    identifier: CatalogIdentifier,
    marketplace?: MarketplaceContext,
  ): Promise<readonly CatalogProduct[]> {
    if (!marketplace) throw new ProviderError("PERMANENT");
    const result = await this.request(
      `/catalog/2022-04-01/items?marketplaceIds=${encodeURIComponent(marketplace.marketplaceId)}&identifiers=${encodeURIComponent(identifier.value)}&identifiersType=${encodeURIComponent(identifier.type)}`,
    );
    const items =
      (result.body as { items?: Array<{ asin?: string }> }).items ?? [];
    return Promise.all(
      items.flatMap((item) =>
        item.asin ? [this.getItem(item.asin, marketplace)] : [],
      ),
    ).then((products) =>
      products.filter((product): product is CatalogProduct => product !== null),
    );
  }

  async searchByKeywords(
    keywords: string,
    marketplace?: MarketplaceContext,
  ): Promise<readonly CatalogProduct[]> {
    if (!marketplace) throw new ProviderError("PERMANENT");
    const result = await this.request(
      `/catalog/2022-04-01/items?marketplaceIds=${encodeURIComponent(marketplace.marketplaceId)}&keywords=${encodeURIComponent(keywords)}`,
    );
    const items =
      (result.body as { items?: Array<{ asin?: string }> }).items ?? [];
    return Promise.all(
      items.flatMap((item) =>
        item.asin ? [this.getItem(item.asin, marketplace)] : [],
      ),
    ).then((products) =>
      products.filter((product): product is CatalogProduct => product !== null),
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
