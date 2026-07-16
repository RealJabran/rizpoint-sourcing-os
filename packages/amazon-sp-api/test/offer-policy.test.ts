import { describe, expect, it } from "vitest";
import { amazonRetailPresence } from "../src/offer-policy.js";

describe("offer identity policy", () => {
  it("never infers Amazon Retail from FBA fulfillment or an unverified seller", () => {
    expect(
      amazonRetailPresence("ATVPDKIKX0DER", ["third-party-fba-seller"]),
    ).toBe("UNKNOWN");
    expect(amazonRetailPresence("ATVPDKIKX0DER", [])).toBe("UNKNOWN");
  });
});
