/** Marketplace-specific seller identity policy. Fulfillment is never seller identity. */
export type AmazonRetailSellerPolicy = Readonly<
  Record<string, readonly string[]>
>;

const RETAIL_SELLER_IDS: AmazonRetailSellerPolicy = {
  // Intentionally empty until a marketplace-specific seller ID is verified and reviewed.
};

export function amazonRetailPresence(
  marketplaceId: string,
  sellerIds: readonly (string | undefined)[],
  sellerSetCompleteness: "COMPLETE" | "PARTIAL" | "UNKNOWN" = "PARTIAL",
  policy: AmazonRetailSellerPolicy = RETAIL_SELLER_IDS,
): "PRESENT" | "ABSENT" | "UNKNOWN" {
  const known = policy[marketplaceId];
  if (!known) return "UNKNOWN";
  if (sellerIds.some((id) => id && known.includes(id))) return "PRESENT";
  return sellerSetCompleteness === "COMPLETE" ? "ABSENT" : "UNKNOWN";
}
