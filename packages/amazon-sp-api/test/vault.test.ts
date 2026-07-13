import { describe, expect, it } from "vitest";
import { AmazonSpApiProvider, CredentialVault } from "../src/index.js";

describe("credential vault", () => {
  const vault = new CredentialVault(new Map([[1, Buffer.alloc(32, 7)]]), 1);

  it("round-trips only with matching authenticated context", () => {
    const encrypted = vault.encrypt("refresh-token", "org:connection");
    expect(vault.decrypt(encrypted, "org:connection")).toBe("refresh-token");
    expect(() => vault.decrypt(encrypted, "other-org:connection")).toThrow();
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
        price: "17.99",
        currency: "USD",
        requestId: "test",
      }),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
