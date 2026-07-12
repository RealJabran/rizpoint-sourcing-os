import { describe, expect, it } from "vitest";
import { MockCatalogProvider } from "../src/index.js";

describe("mock catalog provider", () => {
  it("returns provenance-bearing exact identifier results", async () => {
    const results = await new MockCatalogProvider().searchByIdentifier({
      type: "UPC",
      value: "012345678905",
    });
    expect(results).toHaveLength(1);
    expect(results[0]?.provenance).toMatchObject({
      provider: "mock-catalog",
      freshnessState: "FRESH",
    });
  });

  it("supports the MPN and title-search cascade boundaries", async () => {
    const provider = new MockCatalogProvider();
    expect(
      await provider.searchByIdentifier({ type: "MPN", value: "LEMON-12" }),
    ).toHaveLength(3);
    expect(await provider.searchByKeywords("Lemon Soda")).toHaveLength(3);
  });
});
