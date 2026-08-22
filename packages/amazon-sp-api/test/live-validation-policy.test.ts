import { describe, expect, it } from "vitest";
import { ProviderError } from "@rizpoint/provider-contracts";
import {
  assertLiveValidationOptIn,
  parseLiveValidationArguments,
} from "../src/index.js";

describe("live SP-API validation policy", () => {
  it("requires explicit opt-in and always rejects CI", () => {
    expect(() => assertLiveValidationOptIn({})).toThrow(ProviderError);
    expect(() =>
      assertLiveValidationOptIn({
        CI: "true",
        RIZPOINT_ENABLE_LIVE_SP_API_VALIDATION: "true",
      }),
    ).toThrow(ProviderError);
    expect(() =>
      assertLiveValidationOptIn({
        RIZPOINT_ENABLE_LIVE_SP_API_VALIDATION: "true",
      }),
    ).not.toThrow();
  });

  it("accepts only one to five ASINs and an explicit Decimal price", () => {
    expect(
      parseLiveValidationArguments([
        "--asin",
        "b000000001",
        "--price",
        "24.99",
        "--currency",
        "usd",
      ]),
    ).toEqual({ asins: ["B000000001"], price: "24.99", currency: "USD" });
    expect(() =>
      parseLiveValidationArguments(["--asin", "B000000001"]),
    ).toThrow(ProviderError);
  });
});
