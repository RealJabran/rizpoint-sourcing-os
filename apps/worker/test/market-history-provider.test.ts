import { afterEach, describe, expect, it, vi } from "vitest";
import { ProviderError } from "@rizpoint/provider-contracts";
const { getEncryptedProviderCredentialForWorker } = vi.hoisted(() => ({
  getEncryptedProviderCredentialForWorker: vi.fn(),
}));
vi.mock("@rizpoint/database", () => ({
  getEncryptedProviderCredentialForWorker,
}));
import { createMarketHistoryProvider } from "../src/market-history-provider.js";

describe("market history provider selection", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("uses recorded fixtures by default", async () => {
    vi.stubEnv("MARKET_HISTORY_PROVIDER_MODE", "mock");
    const bundle = await createMarketHistoryProvider({
      organizationId: "org",
      marketplace: { marketplaceId: "ATVPDKIKX0DER", region: "NA" },
    });
    expect(bundle).toMatchObject({
      providerKey: "recorded-history",
      mode: "MOCK",
    });
  });

  it("fails closed for live Keepa mode without an encrypted credential", async () => {
    vi.stubEnv("MARKET_HISTORY_PROVIDER_MODE", "keepa");
    getEncryptedProviderCredentialForWorker.mockResolvedValue(null);
    await expect(
      createMarketHistoryProvider({
        organizationId: "org",
        marketplace: { marketplaceId: "ATVPDKIKX0DER", region: "NA" },
      }),
    ).rejects.toBeInstanceOf(ProviderError);
  });
});
