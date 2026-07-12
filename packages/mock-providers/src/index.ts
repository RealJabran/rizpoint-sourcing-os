import { mockCatalogProducts } from "@rizpoint/test-fixtures";
import type {
  CatalogIdentifier,
  CatalogProduct,
  CatalogProvider,
} from "@rizpoint/provider-contracts";

const observedAt = "2026-07-12T00:00:00Z";

function toCatalogProduct(
  product: (typeof mockCatalogProducts)[number],
): CatalogProduct {
  return {
    ...product,
    identifiers: product.identifiers.map((identifier) => ({ ...identifier })),
    provenance: {
      provider: "mock-catalog",
      observedAt,
      freshnessState: "FRESH",
      providerReference: product.asin,
    },
  };
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
