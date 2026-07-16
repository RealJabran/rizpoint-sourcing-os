/** Marketplace-specific seller identity policy. Fulfillment is never seller identity. */
const RETAIL_SELLER_IDS: Readonly<Record<string, readonly string[]>> = {
  // Intentionally empty until a marketplace-specific seller ID is verified and reviewed.
};

export function amazonRetailPresence(
  marketplaceId: string,
  sellerIds: readonly (string | undefined)[],
): "PRESENT" | "ABSENT" | "UNKNOWN" {
  const known = RETAIL_SELLER_IDS[marketplaceId];
  if (!known) return "UNKNOWN";
  return sellerIds.some((id) => id && known.includes(id))
    ? "PRESENT"
    : "ABSENT";
}
