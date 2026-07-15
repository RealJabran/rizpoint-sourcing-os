import { afterEach, describe, expect, it, vi } from "vitest";
import { ProviderError } from "@rizpoint/provider-contracts";
import { createEnrichmentProvider } from "../src/enrichment-provider.js";

describe("enrichment provider selection", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("uses the fixture adapter without credentials for mock connections", () => {
    const bundle = createEnrichmentProvider(null);
    expect(bundle.providerKind).toBe("MOCK_AMAZON");
    expect(bundle.marketplace.marketplaceId).toBe("ATVPDKIKX0DER");
  });

  it("fails closed instead of silently falling back for an inactive SP-API connection", () => {
    expect(() =>
      createEnrichmentProvider({
        id: "connection",
        organizationId: "organization",
        provider: "AMAZON_SP_API",
        mode: "OAUTH",
        status: "AUTH_REQUIRED",
        sellerId: null,
        marketplaceId: "ATVPDKIKX0DER",
        region: "NA",
        encryptedRefreshToken: null,
        encryptionNonce: null,
        encryptionTag: null,
        encryptionKeyVersion: null,
      }),
    ).toThrow(ProviderError);
  });
});
