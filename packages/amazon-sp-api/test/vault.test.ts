import { describe, expect, it } from "vitest";
import {
  AmazonSpApiProvider,
  CredentialVault,
  retryAfterMilliseconds,
} from "../src/index.js";

describe("credential vault", () => {
  const vault = new CredentialVault(new Map([[1, Buffer.alloc(32, 7)]]), 1);

  it("round-trips only with matching authenticated context", () => {
    const encrypted = vault.encrypt("refresh-token", "org:connection");
    expect(vault.decrypt(encrypted, "org:connection")).toBe("refresh-token");
    expect(() => vault.decrypt(encrypted, "other-org:connection")).toThrow();
  });
});

describe("SP-API retry timing", () => {
  it("parses both delta-seconds and HTTP-date retry headers", () => {
    expect(retryAfterMilliseconds("12", 0)).toBe(12_000);
    expect(
      retryAfterMilliseconds(
        "Wed, 15 Jul 2026 00:00:05 GMT",
        Date.UTC(2026, 6, 15),
      ),
    ).toBe(5_000);
    expect(retryAfterMilliseconds("not-a-date", 0)).toBeUndefined();
  });
});

it("rejects a fee response without an estimate instead of storing zero", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ payload: {} }), { status: 200 });
  try {
    const provider = new AmazonSpApiProvider(
      { clientId: "x", clientSecret: "x", endpoint: "https://example.test" },
      async () => "token",
    );
    await expect(
      provider.estimateFees({
        asin: "B000000001",
        marketplace: { marketplaceId: "ATVPDKIKX0DER", region: "NA" },
        fulfillmentChannel: "AMAZON",
        scenarioSource: "CURRENT_FEATURED_OFFER",
        price: "17.99",
        shippingPrice: "0",
        currency: "USD",
        requestId: "test",
      }),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
