import { mockCatalogProducts } from "@rizpoint/test-fixtures";
import { Decimal } from "decimal.js";
import type {
  CatalogIdentifier,
  CatalogProduct,
  CatalogProvider,
  CompetitivePricing,
  CurrentOffers,
  FeeEstimate,
  FeeEstimateRequest,
  FeeProvider,
  MarketHistory,
  MarketHistoryProvider,
  MarketplaceContext,
  PricingProvider,
  ProviderHealth,
  ProviderHealthProvider,
  RestrictionProvider,
  Restrictions,
} from "@rizpoint/provider-contracts";
import { catalogProductSchema } from "@rizpoint/provider-contracts";

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
    ProviderHealthProvider
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
    _marketplace: MarketplaceContext,
  ): Promise<CompetitivePricing> {
    void _marketplace;
    return {
      value: {
        currency: "USD",
        buyBoxPrice: asin === "B000000001" ? "18.99" : "22.99",
        lowestPrice: asin === "B000000001" ? "17.99" : "21.99",
        offerCount: 4,
      },
      provenance: {
        provider: "mock-amazon",
        observedAt: observedAt(),
        freshnessState: "FRESH",
        providerReference: asin,
      },
    };
  }

  async estimateFees(request: FeeEstimateRequest): Promise<FeeEstimate> {
    const fixedFee = "2.0000";
    const percentageOfPrice = "0.1500";
    const totalFee = new Decimal(fixedFee)
      .plus(new Decimal(request.price).mul(percentageOfPrice))
      .toFixed(4);
    return {
      value: {
        totalFee,
        quotedPrice: request.price,
        currency: request.currency,
        model: { fixedFee, percentageOfPrice },
      },
      provenance: {
        provider: "mock-amazon",
        observedAt: observedAt(),
        freshnessState: "FRESH",
        providerReference: request.requestId,
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
        status: asin === "B000000003" ? "REQUIRES_APPROVAL" : "ALLOWED",
      },
      provenance: {
        provider: "mock-amazon",
        observedAt: observedAt(),
        freshnessState: "FRESH",
        providerReference: asin,
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
      status: "HEALTHY",
      checkedAt: observedAt(),
    };
  }
}
