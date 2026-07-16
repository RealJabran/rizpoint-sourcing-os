import { describe, expect, it } from "vitest";
import { amazonRetailPresence } from "../src/offer-policy.js";

describe("offer identity policy", () => {
  it("never infers Amazon Retail from FBA fulfillment or an unverified seller", () => {
    expect(
      amazonRetailPresence("ATVPDKIKX0DER", ["third-party-fba-seller"]),
    ).toBe("UNKNOWN");
    expect(amazonRetailPresence("ATVPDKIKX0DER", [])).toBe("UNKNOWN");
  });

  it("returns present/absent only from a verified marketplace policy and complete seller set", () => {
    const policy = { ATVPDKIKX0DER: ["verified-amazon-retail"] };
    expect(
      amazonRetailPresence(
        "ATVPDKIKX0DER",
        ["verified-amazon-retail"],
        "PARTIAL",
        policy,
      ),
    ).toBe("PRESENT");
    expect(
      amazonRetailPresence(
        "ATVPDKIKX0DER",
        ["third-party-fba"],
        "COMPLETE",
        policy,
      ),
    ).toBe("ABSENT");
    expect(
      amazonRetailPresence(
        "ATVPDKIKX0DER",
        ["third-party-fba"],
        "PARTIAL",
        policy,
      ),
    ).toBe("UNKNOWN");
  });
});
