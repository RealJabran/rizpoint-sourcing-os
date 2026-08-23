const MARKETPLACE_LABELS: Record<string, string> = {
  ATVPDKIKX0DER: "United States",
  A2EUQ1WTGCTBG2: "Canada",
  A1F83G8C2ARO7P: "United Kingdom",
  A1PA6795UKMFR9: "Germany",
  A13V1IB3VIYZZH: "France",
  APJ6JRA9NG5V4: "Italy",
  A1RKKUPIHCS9HS: "Spain",
};

export function marketplaceLabel(marketplaceId: string | null | undefined) {
  if (!marketplaceId) return "Marketplace unavailable";
  return MARKETPLACE_LABELS[marketplaceId] ?? "Connected marketplace";
}
