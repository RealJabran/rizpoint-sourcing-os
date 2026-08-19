export type MarketplaceDefinition = {
  id: string;
  domain: string;
  locale: string;
  language: string;
  currency: string;
  timeZone: string;
  categoryMappingVersion: string;
  feeModelVersion: string;
  capabilities: readonly string[];
};
export const MARKETPLACES: readonly MarketplaceDefinition[] = [
  {
    id: "ATVPDKIKX0DER",
    domain: "amazon.com",
    locale: "en-US",
    language: "en",
    currency: "USD",
    timeZone: "America/Los_Angeles",
    categoryMappingVersion: "us/v1",
    feeModelVersion: "us/v1",
    capabilities: ["CATALOG", "FEES", "MARKET_HISTORY", "KEYWORD_DISCOVERY"],
  },
  {
    id: "A1F83G8C2ARO7P",
    domain: "amazon.co.uk",
    locale: "en-GB",
    language: "en",
    currency: "GBP",
    timeZone: "Europe/London",
    categoryMappingVersion: "uk/v1",
    feeModelVersion: "uk/v1",
    capabilities: ["CATALOG"],
  },
  {
    id: "A1PA6795UKMFR9",
    domain: "amazon.de",
    locale: "de-DE",
    language: "de",
    currency: "EUR",
    timeZone: "Europe/Berlin",
    categoryMappingVersion: "de/v1",
    feeModelVersion: "de/v1",
    capabilities: ["CATALOG"],
  },
  {
    id: "A2EUQ1WTGCTBG2",
    domain: "amazon.ca",
    locale: "en-CA",
    language: "en",
    currency: "CAD",
    timeZone: "America/Toronto",
    categoryMappingVersion: "ca/v1",
    feeModelVersion: "ca/v1",
    capabilities: ["CATALOG"],
  },
];
export function marketplaceById(id: string) {
  return MARKETPLACES.find((x) => x.id === id) ?? null;
}
export function canCompareAcrossMarkets(
  left: MarketplaceDefinition,
  right: MarketplaceDefinition,
  normalizedCurrency: string | undefined,
) {
  return (
    left.id === right.id ||
    Boolean(normalizedCurrency && left.currency !== right.currency)
  );
}
