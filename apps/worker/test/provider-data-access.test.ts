import { describe, expect, it } from "vitest";
import {
  normalizeProviderRequest,
  providerFreshnessPolicy,
  providerRequestHash,
} from "../src/provider-data-access.js";

describe("persistent provider data access policy", () => {
  it("canonicalizes object keys without changing phrase case or array order", () => {
    const left = {
      marketplaceId: "ATVPDKIKX0DER",
      query: "Travel Mug",
      filters: { b: 2, a: 1, ignored: undefined },
      asins: ["B000000002", "B000000001"],
    };
    const right = {
      asins: ["B000000002", "B000000001"],
      filters: { a: 1, b: 2 },
      query: "Travel Mug",
      marketplaceId: "ATVPDKIKX0DER",
    };
    expect(providerRequestHash(left)).toBe(providerRequestHash(right));
    expect(normalizeProviderRequest(left)).toMatchObject({
      query: "Travel Mug",
      asins: ["B000000002", "B000000001"],
    });
    expect(providerRequestHash({ ...right, query: "travel mug" })).not.toBe(
      providerRequestHash(right),
    );
  });

  it("loads explicit capability overrides and rejects unsafe retention", () => {
    expect(
      providerFreshnessPolicy("COMPETITIVE_OFFERS", {
        RIZPOINT_CACHE_COMPETITIVE_OFFERS_FRESH_SECONDS: "60",
        RIZPOINT_CACHE_COMPETITIVE_OFFERS_STALE_SECONDS: "30",
        RIZPOINT_CACHE_COMPETITIVE_OFFERS_RETAIN_SECONDS: "90",
      }),
    ).toMatchObject({
      freshForSeconds: 60,
      staleWhileRevalidateSeconds: 30,
      retainForSeconds: 90,
    });
    expect(() =>
      providerFreshnessPolicy("COMPETITIVE_OFFERS", {
        RIZPOINT_CACHE_COMPETITIVE_OFFERS_FRESH_SECONDS: "60",
        RIZPOINT_CACHE_COMPETITIVE_OFFERS_STALE_SECONDS: "31",
        RIZPOINT_CACHE_COMPETITIVE_OFFERS_RETAIN_SECONDS: "90",
      }),
    ).toThrow("PROVIDER_RETENTION_WINDOW_INVALID");
  });
});
