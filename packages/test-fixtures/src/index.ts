export const mockScannerResult = {
  scanner: "mock",
  row_count: 3,
  checksum: "fixture-only",
} as const;

export const mockCatalogProducts = [
  {
    asin: "B000000001",
    title: "Acme Lemon Soda 12 oz Pack of 6",
    brand: "Acme",
    model: "LEMON-12",
    mpn: "LEMON-12",
    sizeText: "12 oz",
    packCount: 6,
    variation: "Lemon",
    variationTheme: "Flavor",
    manufacturer: "Acme Foods",
    color: "Yellow",
    productTypes: ["GROCERY"],
    packageHierarchy: [{ type: "VARIATION", asin: "B000000002" }],
    images: [
      {
        // A self-contained image keeps mock-mode browser tests offline and
        // deterministic. Live Catalog Items observations may still provide
        // allowlisted Amazon image hotlinks.
        url: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='12' fill='%230d4f47'/%3E%3Cpath d='M20 18h24v28H20z' fill='%23f5d54a'/%3E%3Cpath d='M20 30h24' stroke='%230d4f47' stroke-width='4'/%3E%3C/svg%3E",
        variant: "MAIN",
      },
    ],
    identifiers: [{ type: "UPC", value: "012345678905" }],
  },
  {
    asin: "B000000002",
    title: "Acme Lemon Soda 12 oz Pack of 12",
    brand: "Acme",
    model: "LEMON-12",
    mpn: "LEMON-12",
    sizeText: "12 oz",
    packCount: 12,
    variation: "Lemon",
    variationTheme: "Flavor",
    packageHierarchy: [{ type: "VARIATION", asin: "B000000001" }],
    identifiers: [{ type: "UPC", value: "012345678912" }],
  },
  {
    asin: "B000000003",
    title: "OtherBrand Lemon Soda 12 oz Pack of 6",
    brand: "OtherBrand",
    model: "LEMON-12",
    mpn: "LEMON-12",
    sizeText: "12 oz",
    packCount: 6,
    variation: "Lemon",
    identifiers: [{ type: "MPN", value: "LEMON-12" }],
  },
] as const;
