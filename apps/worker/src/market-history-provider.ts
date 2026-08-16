import { vaultFromEnvironment } from "@rizpoint/amazon-sp-api";
import { getEncryptedProviderCredentialForWorker } from "@rizpoint/database";
import { KeepaMarketHistoryProvider } from "@rizpoint/keepa-api";
import { RecordedMarketHistoryProvider } from "@rizpoint/mock-providers";
import type {
  MarketHistoryProvider,
  MarketplaceContext,
  ProviderRuntimeMode,
} from "@rizpoint/provider-contracts";
import { ProviderError } from "@rizpoint/provider-contracts";

export type MarketHistoryProviderBundle = {
  provider: MarketHistoryProvider;
  providerKey: "keepa" | "recorded-history";
  mode: ProviderRuntimeMode;
};

/**
 * A Keepa key is stored only as an encrypted provider credential.  The default
 * fixture adapter is explicit and cannot become live merely because an env var
 * happens to exist.
 */
export async function createMarketHistoryProvider(input: {
  organizationId: string;
  marketplace: MarketplaceContext;
}): Promise<MarketHistoryProviderBundle> {
  if (process.env.MARKET_HISTORY_PROVIDER_MODE !== "keepa")
    return {
      provider: new RecordedMarketHistoryProvider(),
      providerKey: "recorded-history",
      mode: "MOCK",
    };
  const envelope = await getEncryptedProviderCredentialForWorker({
    organizationId: input.organizationId,
    providerKey: "keepa",
    credentialName: "api_key",
  });
  const vault = vaultFromEnvironment();
  if (!envelope || !vault) throw new ProviderError("UNAUTHORIZED");
  let apiKey: string;
  try {
    apiKey = vault.decrypt(
      {
        ciphertext: envelope.ciphertext,
        nonce: envelope.encryptionNonce,
        tag: envelope.encryptionTag,
        keyVersion: envelope.encryptionKeyVersion,
      },
      `${input.organizationId}:keepa:api_key`,
    );
  } catch {
    throw new ProviderError("UNAUTHORIZED");
  }
  if (!apiKey.trim()) throw new ProviderError("UNAUTHORIZED");
  return {
    provider: new KeepaMarketHistoryProvider({
      apiKey,
      ...(process.env.KEEPA_API_ENDPOINT
        ? { endpoint: process.env.KEEPA_API_ENDPOINT }
        : {}),
    }),
    providerKey: "keepa",
    mode: "LIVE",
  };
}
