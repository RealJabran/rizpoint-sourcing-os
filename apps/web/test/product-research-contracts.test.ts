import { describe, expect, it } from "vitest";
import {
  normalizeProductLookup,
  parseAmazonAsin,
} from "../src/product-research/contracts";

describe("product research input", () => {
  it("accepts ASINs and extracts only identifiers from supported Amazon URLs", () => {
    expect(parseAmazonAsin("b000000001")).toBe("B000000001");
    expect(
      parseAmazonAsin(
        "https://www.amazon.com/example/dp/B000000001?tag=ignored",
      ),
    ).toBe("B000000001");
    expect(
      parseAmazonAsin("https://www.amazon.co.uk/gp/product/B000000001"),
    ).toBe("B000000001");
  });

  it("rejects lookalike hosts and classifies standard identifiers deterministically", () => {
    expect(
      parseAmazonAsin("https://amazon.com.attacker.example/dp/B000000001"),
    ).toBeNull();
    expect(normalizeProductLookup("012345678905")).toEqual({
      queryType: "UPC",
      queryText: "012345678905",
    });
    expect(normalizeProductLookup("4006381333931")).toEqual({
      queryType: "EAN",
      queryText: "4006381333931",
    });
    expect(normalizeProductLookup("not a product")).toBeNull();
  });
});
