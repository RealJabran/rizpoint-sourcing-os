import type { Money, PackGuardStatus } from "@rizpoint/domain";

export interface ProfitCalculationInput {
  readonly packGuardStatus: PackGuardStatus;
  readonly modeledSellingPrice: Money;
}

/**
 * The Phase 0 seam deliberately refuses calculation until the full versioned
 * Decimal formula engine and all required cost inputs arrive in Phase 4.
 */
export function assertCalculationAllowed(input: ProfitCalculationInput): void {
  if (input.packGuardStatus !== "VERIFIED") {
    throw new Error(
      "Profit calculation is blocked until the pack relationship is verified.",
    );
  }
}
