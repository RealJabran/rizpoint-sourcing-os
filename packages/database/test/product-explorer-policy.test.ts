import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { PRODUCT_EXPLORER_PAGE_LIMIT } from "../src/repositories/product-explorer.js";

describe("Product Explorer tenant-universe policy", () => {
  it("uses bounded windows and does not expose unscoped catalog rows", async () => {
    expect(PRODUCT_EXPLORER_PAGE_LIMIT).toBe(100);
    const source = await readFile(
      new URL("../src/repositories/product-explorer.ts", import.meta.url),
      "utf8",
    );
    expect(source).toContain("FROM listing_candidates lc");
    expect(source).toContain("FROM research_project_items rpi");
    expect(source).toContain("FROM product_watches pw");
    expect(source).toContain("FROM market_members mm");
    expect(source).toContain("LIMIT ${limit} OFFSET ${input.offset}");
    expect(source).not.toContain("FROM catalog_products cp\n      ORDER BY");
  });
});
