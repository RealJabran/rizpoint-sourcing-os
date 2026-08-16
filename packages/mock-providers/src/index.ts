import { mockCatalogProducts } from "@rizpoint/test-fixtures";
import { Decimal } from "decimal.js";
import type {
  CatalogIdentifier,
  CatalogProduct,
  CatalogProvider,
  CompetitivePricing,
  CompetitivePricingBatchResult,
  CurrentOffers,
  FeeEstimate,
  FeeEstimateRequest,
  FeeProvider,
  MarketHistory,
  MarketHistoryProvider,
  MarketplaceContext,
  PricingProvider,
  ProviderCapability,
  ProviderCapabilityDiscovery,
  ProviderCapabilityState,
  ProviderHealth,
  ProviderHealthProvider,
  RestrictionProvider,
  Restrictions,
} from "@rizpoint/provider-contracts";
import {
  catalogProductSchema,
  ProviderError,
} from "@rizpoint/provider-contracts";

const observedAt = () => new Date().toISOString();

function toCatalogProduct(
  product: (typeof mockCatalogProducts)[number],
): CatalogProduct {
  const extended = product as (typeof mockCatalogProducts)[number] & {
    productTypes?: readonly string[];
    packageHierarchy?: readonly { type: string; asin?: string }[];
    images?: readonly {
      url: string;
      variant?: string;
      height?: number;
      width?: number;
    }[];
  };
  return catalogProductSchema.parse({
    ...product,
    identifiers: product.identifiers.map((identifier) => ({ ...identifier })),
    ...(extended.productTypes
      ? { productTypes: [...extended.productTypes] }
      : {}),
    ...(extended.packageHierarchy
      ? {
          packageHierarchy: extended.packageHierarchy.map((item) => ({
            ...item,
          })),
        }
      : {}),
    ...(extended.images
      ? { images: extended.images.map((image) => ({ ...image })) }
      : {}),
    provenance: {
      provider: "mock-catalog",
      observedAt: observedAt(),
      freshnessState: "FRESH",
      providerReference: product.asin,
    },
  });
}

export class MockCatalogProvider implements CatalogProvider {
  async searchByIdentifier(
    identifier: CatalogIdentifier,
  ): Promise<readonly CatalogProduct[]> {
    const target = identifier.value.trim().toUpperCase();
    return mockCatalogProducts
      .filter(
        (product) =>
          product.identifiers.some(
            (candidate) =>
              candidate.type === identifier.type &&
              candidate.value.toUpperCase() === target,
          ) ||
          (identifier.type === "MPN" &&
            product.mpn?.toUpperCase() === target) ||
          (identifier.type === "ASIN" && product.asin === target),
      )
      .map(toCatalogProduct);
  }

  async searchByKeywords(keywords: string): Promise<readonly CatalogProduct[]> {
    const tokens = keywords.toLocaleLowerCase().split(/\s+/).filter(Boolean);
    return mockCatalogProducts
      .filter((product) => {
        const title = product.title.toLocaleLowerCase();
        return tokens.some((token) => title.includes(token));
      })
      .map(toCatalogProduct);
  }

  async getItem(asin: string): Promise<CatalogProduct | null> {
    const product = mockCatalogProducts.find(
      (candidate) => candidate.asin === asin,
    );
    return product ? toCatalogProduct(product) : null;
  }
}

export class MockAmazonProvider
  implements
    CatalogProvider,
    PricingProvider,
    FeeProvider,
    RestrictionProvider,
    MarketHistoryProvider,
    ProviderHealthProvider,
    ProviderCapabilityDiscovery
{
  private readonly catalog = new MockCatalogProvider();

  async searchByIdentifier(
    identifier: CatalogIdentifier,
    _marketplace?: MarketplaceContext,
  ): Promise<readonly CatalogProduct[]> {
    void _marketplace;
    return this.catalog.searchByIdentifier(identifier);
  }

  async searchByKeywords(
    keywords: string,
    _marketplace?: MarketplaceContext,
  ): Promise<readonly CatalogProduct[]> {
    void _marketplace;
    return this.catalog.searchByKeywords(keywords);
  }

  async getItem(
    asin: string,
    _marketplace?: MarketplaceContext,
  ): Promise<CatalogProduct | null> {
    void _marketplace;
    return this.catalog.getItem(asin);
  }

  async getCurrentOffers(
    asin: string,
    _marketplace: MarketplaceContext,
  ): Promise<CurrentOffers> {
    void _marketplace;
    return {
      value: [
        {
          sellerId: "mock-seller",
          price: asin === "B000000001" ? "18.99" : "22.99",
          currency: "USD",
        },
      ],
      provenance: {
        provider: "mock-amazon",
        observedAt: observedAt(),
        freshnessState: "FRESH",
        providerReference: asin,
      },
    };
  }

  async getCompetitivePricing(
    asin: string,
    marketplace: MarketplaceContext,
  ): Promise<CompetitivePricing> {
    const state =
      asin === "B000000001"
        ? ("PRESENT" as const)
        : asin === "B000000002"
          ? ("ABSENT" as const)
          : ("UNKNOWN" as const);
    const featuredPrice = asin === "B000000001" ? "18.99" : undefined;
    return {
      value: {
        operation: "getCompetitiveSummary",
        asin,
        marketplaceId: marketplace.marketplaceId,
        currency: "USD",
        ...(featuredPrice ? { buyBoxPrice: featuredPrice } : {}),
        lowestPrice: asin === "B000000001" ? "17.99" : "21.99",
        offerCount: 4,
        featuredOfferState: state,
        ...(featuredPrice
          ? {
              featuredOffer: {
                sellerId: "mock-featured-seller",
                condition: "New",
                fulfillmentChannel: "MERCHANT" as const,
                listingPrice: featuredPrice,
                shippingPrice: "0.00",
                landedPrice: featuredPrice,
                currency: "USD",
                memberships: ["DEFAULT" as const],
                isFeatured: true,
              },
            }
          : {}),
        completeness: state === "UNKNOWN" ? "PARTIAL" : "COMPLETE",
        totalVisibleOffers: { value: 4, completeness: "COMPLETE" },
        fbaVisibleOffers: { value: 2, completeness: "COMPLETE" },
        fbmVisibleOffers: { value: 2, completeness: "COMPLETE" },
        visibleOfferCount: 4,
        fbaOfferCount: 2,
        fbmOfferCount: 2,
        amazonRetailPresence:
          asin === "B000000001"
            ? "PRESENT"
            : asin === "B000000002"
              ? "ABSENT"
              : "UNKNOWN",
        brandSellerStatus: "UNKNOWN",
        lowestFbaPrice: asin === "B000000001" ? "17.99" : "21.99",
        lowestFbmPrice: asin === "B000000001" ? "18.49" : "22.49",
        offers: [
          {
            sellerId: "mock-fba-seller",
            condition: "New",
            fulfillmentChannel: "AMAZON",
            listingPrice: asin === "B000000001" ? "17.99" : "21.99",
            shippingPrice: "0.00",
            landedPrice: asin === "B000000001" ? "17.99" : "21.99",
            currency: "USD",
            memberships: [],
            isFeatured: false,
          },
          {
            sellerId: "mock-fbm-seller",
            condition: "New",
            fulfillmentChannel: "MERCHANT",
            listingPrice: asin === "B000000001" ? "18.49" : "22.49",
            shippingPrice: "0.00",
            landedPrice: asin === "B000000001" ? "18.49" : "22.49",
            currency: "USD",
            memberships: [],
            isFeatured: false,
          },
        ],
      },
      provenance: {
        provider: "mock-amazon",
        observedAt: observedAt(),
        freshnessState: "FRESH",
        providerReference: asin,
        marketplaceId: marketplace.marketplaceId,
        responseCompleteness: state === "UNKNOWN" ? "PARTIAL" : "COMPLETE",
      },
    };
  }

  async getCompetitivePricingBatch(
    asins: readonly string[],
    marketplace: MarketplaceContext,
  ): Promise<readonly CompetitivePricingBatchResult[]> {
    if (
      asins.length < 1 ||
      asins.length > 20 ||
      new Set(asins).size !== asins.length
    )
      throw new ProviderError("INVALID_REQUEST");
    return Promise.all(
      asins.map(async (asin) => ({
        asin,
        status: "SUCCESS" as const,
        pricing: await this.getCompetitivePricing(asin, marketplace),
      })),
    );
  }

  async estimateFees(request: FeeEstimateRequest): Promise<FeeEstimate> {
    const fixedFee = "2.0000";
    const percentageOfPrice = "0.1500";
    const percentageFee = new Decimal(request.price)
      .mul(percentageOfPrice)
      .toFixed(4);
    const totalFee = new Decimal(fixedFee).plus(percentageFee).toFixed(4);
    return {
      value: {
        operation: "getMyFeesEstimateForASIN",
        asin: request.asin,
        marketplaceId: request.marketplace.marketplaceId,
        totalFee,
        quotedPrice: request.price,
        listingPrice: request.listingPrice ?? request.price,
        shippingPrice: request.shippingPrice,
        currency: request.currency,
        fulfillmentChannel: request.fulfillmentChannel,
        scenarioSource: request.scenarioSource,
        completeness: "COMPLETE",
        components: [
          {
            feeType: "FulfillmentFee",
            feeAmount: fixedFee,
            finalFee: fixedFee,
            currency: request.currency,
          },
          {
            feeType: "ReferralFee",
            feeAmount: percentageFee,
            finalFee: percentageFee,
            currency: request.currency,
          },
        ],
        model: { fixedFee, percentageOfPrice },
      },
      provenance: {
        provider: "mock-amazon",
        observedAt: observedAt(),
        freshnessState: "FRESH",
        providerReference: request.requestId,
        marketplaceId: request.marketplace.marketplaceId,
        requestId: request.requestId,
        responseCompleteness: "COMPLETE",
      },
    };
  }

  async getRestrictions(
    asin: string,
    _marketplace: MarketplaceContext,
  ): Promise<Restrictions> {
    void _marketplace;
    return {
      value: {
        operation: "getListingsRestrictions",
        asin,
        marketplaceId: _marketplace.marketplaceId,
        state: asin === "B000000003" ? "APPROVAL_REQUIRED" : "ELIGIBLE",
        completeness: "COMPLETE",
        conditionType: "new_new",
        reasons:
          asin === "B000000003"
            ? [
                {
                  code: "APPROVAL_REQUIRED" as const,
                  message:
                    "Approval is required for this deterministic fixture.",
                  links: [],
                },
              ]
            : [],
      },
      provenance: {
        provider: "mock-amazon",
        observedAt: observedAt(),
        freshnessState: "FRESH",
        providerReference: asin,
        marketplaceId: _marketplace.marketplaceId,
        responseCompleteness: "COMPLETE",
      },
    };
  }

  async getHistory(
    asin: string,
    _marketplace: MarketplaceContext,
  ): Promise<MarketHistory> {
    void _marketplace;
    return {
      value: [
        {
          observedAt: observedAt(),
          price: asin === "B000000001" ? "18.99" : "22.99",
          currency: "USD",
        },
      ],
      provenance: {
        provider: "mock-history",
        observedAt: observedAt(),
        freshnessState: "FRESH",
        providerReference: asin,
      },
    };
  }

  async health(): Promise<ProviderHealth> {
    return {
      provider: "mock-amazon",
      mode: "MOCK",
      status: "HEALTHY",
      checkedAt: observedAt(),
      capabilities: [
        ...(await this.capabilities({
          marketplaceId: "ATVPDKIKX0DER",
          region: "NA",
        })),
      ],
    };
  }

  async capabilities(
    marketplace: MarketplaceContext,
  ): Promise<readonly ProviderCapabilityState[]> {
    return mockCapabilityStates(marketplace.marketplaceId);
  }
}

const MOCK_CAPABILITIES: readonly ProviderCapability[] = [
  "CATALOG",
  "COMPETITIVE_OFFERS",
  "FEES",
  "RESTRICTIONS",
  "MARKET_HISTORY",
];

export function mockCapabilityStates(
  marketplaceId: string,
  state: ProviderCapabilityState["state"] = "HEALTHY",
  checkedAt = observedAt(),
): ProviderCapabilityState[] {
  return MOCK_CAPABILITIES.map((capability) => ({
    providerKey: "mock-amazon",
    marketplaceId,
    capability,
    mode: "MOCK",
    state,
    checkedAt,
    completeness: state === "PARTIAL" ? "PARTIAL" : "COMPLETE",
    ...(state === "THROTTLED"
      ? { reason: "PROVIDER_THROTTLED" as const }
      : state === "QUOTA_EXHAUSTED"
        ? { reason: "QUOTA_WINDOW_EXHAUSTED" as const }
        : state === "PARTIAL"
          ? { reason: "PARTIAL_RESPONSE" as const }
          : state === "UNAVAILABLE"
            ? { reason: "PROVIDER_OUTAGE" as const }
            : {}),
  }));
}

/** Deterministic fault boundary for runtime and UI tests. It never changes the
 * provider mode, so an unhealthy fixture cannot be mistaken for live data. */
export class MockProviderCapabilityDiscovery implements ProviderCapabilityDiscovery {
  constructor(
    private readonly state: ProviderCapabilityState["state"] = "HEALTHY",
  ) {}

  async capabilities(
    marketplace: MarketplaceContext,
  ): Promise<readonly ProviderCapabilityState[]> {
    return mockCapabilityStates(marketplace.marketplaceId, this.state);
  }
}
