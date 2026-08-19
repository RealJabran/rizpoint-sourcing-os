import { expect, it } from "vitest";
import {
  canCompareAcrossMarkets,
  marketplaceById,
} from "../src/marketplace-registry.js";
it("preserves US defaults and rejects unnormalised cross-market comparisons", () => {
  const us = marketplaceById("ATVPDKIKX0DER")!,
    uk = marketplaceById("A1F83G8C2ARO7P")!;
  expect(us.currency).toBe("USD");
  expect(canCompareAcrossMarkets(us, uk, undefined)).toBe(false);
  expect(canCompareAcrossMarkets(us, uk, "USD")).toBe(true);
});
