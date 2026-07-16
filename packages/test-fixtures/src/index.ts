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
        url: "https://images-na.ssl-images-amazon.com/images/I/mock-lemon-soda.jpg",
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
