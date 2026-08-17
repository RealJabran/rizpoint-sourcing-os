import { describe, expect, it } from "vitest";
import {
  PRODUCT_EXPLORER_PRESETS,
  productExplorerActionSchema,
  productExplorerQuerySchema,
  productExplorerViewSchema,
} from "../src/product-explorer/contracts.js";

describe("Product Explorer contracts", () => {
  it("bounds server windows and accepts only typed stored-metric filters", () => {
    expect(
      productExplorerQuerySchema.parse({ limit: 100, maxReviewCount: 20 }),
    ).toMatchObject({ limit: 100, maxReviewCount: 20 });
    expect(productExplorerQuerySchema.safeParse({ limit: 101 }).success).toBe(
      false,
    );
    expect(
      productExplorerQuerySchema.parse({ opportunityScore: 99 }),
    ).not.toHaveProperty("opportunityScore");
  });

  it("requires a project or marketplace for state-changing product actions", () => {
    expect(
      productExplorerActionSchema.safeParse({
        action: "SAVE_TO_PROJECT",
        productIds: ["product-1"],
      }).success,
    ).toBe(false);
    expect(
      productExplorerActionSchema.parse({
        action: "WATCH",
        productIds: ["product-1"],
        marketplaceId: "ATVPDKIKX0DER",
      }).action,
    ).toBe("WATCH");
  });

  it("keeps saved query state separate from paging and ships an explainable low-review preset", () => {
    expect(
      productExplorerViewSchema.parse({
        name: "Stable",
        queryState: { maxReviewCount: 100 },
      }).queryState,
    ).not.toHaveProperty("offset");
    expect(
      PRODUCT_EXPLORER_PRESETS.find(
        (preset) => preset.id === "low-review-stable-demand",
      )?.explanation,
    ).toContain("does not estimate demand from BSR");
  });
});
