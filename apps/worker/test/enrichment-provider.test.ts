import { afterEach, describe, expect, it, vi } from "vitest";
import { ProviderError } from "@rizpoint/provider-contracts";
import { createEnrichmentProvider } from "../src/enrichment-provider.js";

describe("enrichment provider selection", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("uses the fixture adapter without credentials for mock connections", () => {
    vi.stubEnv("PROVIDER_MODE", "mock");
    vi.stubEnv("PHASE_ZERO_DEMO_MODE", "true");
    const bundle = createEnrichmentProvider(null);
    expect(bundle.providerKind).toBe("MOCK_AMAZON");
    expect(bundle.mode).toBe("MOCK");
    expect(bundle.providerKey).toBe("mock-amazon");
    expect(bundle.marketplace.marketplaceId).toBe("ATVPDKIKX0DER");
  });

  it("never disguises a missing live connection as the mock provider", () => {
    vi.stubEnv("PROVIDER_MODE", "mock");
    vi.stubEnv("PHASE_ZERO_DEMO_MODE", "false");
    expect(() => createEnrichmentProvider(null)).toThrow(ProviderError);
  });

  it("does not fall back to fixtures when a local live connection is revoked", () => {
    vi.stubEnv("PROVIDER_MODE", "mock");
    vi.stubEnv("PHASE_ZERO_DEMO_MODE", "true");
    expect(() =>
      createEnrichmentProvider({
        id: "connection",
        organizationId: "organization",
        provider: "AMAZON_SP_API",
        mode: "SELF_AUTHORIZED",
        status: "REVOKED",
        sellerId: "seller",
        marketplaceId: "ATVPDKIKX0DER",
        region: "NA",
        encryptedRefreshToken: null,
        encryptionNonce: null,
        encryptionTag: null,
        encryptionKeyVersion: null,
      }),
    ).toThrow(ProviderError);
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
