import {
  AmazonSpApiProvider,
  LwaAccessTokenProvider,
  providerMode,
  readSpApiConfig,
  vaultFromEnvironment,
} from "@rizpoint/amazon-sp-api";
import { MockAmazonProvider } from "@rizpoint/mock-providers";
import type {
  CatalogProvider,
  FeeProvider,
  MarketHistoryProvider,
  MarketplaceContext,
  PricingProvider,
  RestrictionProvider,
} from "@rizpoint/provider-contracts";
import { ProviderError } from "@rizpoint/provider-contracts";

type EnrichmentProvider = CatalogProvider &
  PricingProvider &
  FeeProvider &
  RestrictionProvider &
  MarketHistoryProvider;

export type EnrichmentConnection = {
  id: string;
  organizationId: string;
  provider: "AMAZON_SP_API" | "MOCK_AMAZON" | "MOCK_HISTORY";
  mode: "MOCK" | "SELF_AUTHORIZED" | "OAUTH";
  status: "PENDING" | "ACTIVE" | "AUTH_REQUIRED" | "REVOKED" | "ERROR";
  sellerId: string | null;
  marketplaceId: string;
  region: string;
  encryptedRefreshToken: string | null;
  encryptionNonce: string | null;
  encryptionTag: string | null;
  encryptionKeyVersion: number | null;
};

export type EnrichmentProviderBundle = {
  provider: EnrichmentProvider;
  providerKind: "AMAZON_SP_API" | "MOCK_AMAZON";
  marketplace: MarketplaceContext;
};

function mockBundle(): EnrichmentProviderBundle {
  return {
    provider: new MockAmazonProvider(),
    providerKind: "MOCK_AMAZON",
    marketplace: {
      marketplaceId: "ATVPDKIKX0DER",
      region: "NA",
      sellerId: "mock-seller",
    },
  };
}

/**
 * Real credentials are decrypted only in the worker and only for an explicitly
 * active SP-API connection. Fixture mode remains the default local boundary.
 */
export function createEnrichmentProvider(
  connection: EnrichmentConnection | null | undefined,
): EnrichmentProviderBundle {
  if (!connection || connection.mode === "MOCK") return mockBundle();
  if (
    providerMode() !== "sp_api" ||
    connection.provider !== "AMAZON_SP_API" ||
    connection.status !== "ACTIVE" ||
    !connection.sellerId ||
    !connection.encryptedRefreshToken ||
    !connection.encryptionNonce ||
    !connection.encryptionTag ||
    !connection.encryptionKeyVersion ||
    !process.env.SP_API_LWA_CLIENT_ID ||
    !process.env.SP_API_LWA_CLIENT_SECRET ||
    !process.env.SP_API_ENDPOINT
  )
    throw new ProviderError("UNAUTHORIZED");
  if (
    connection.region !== "NA" &&
    connection.region !== "EU" &&
    connection.region !== "FE"
  )
    throw new ProviderError("PERMANENT");
  const vault = vaultFromEnvironment();
  if (!vault) throw new ProviderError("UNAUTHORIZED");
  let refreshToken: string;
  try {
    refreshToken = vault.decrypt(
      {
        ciphertext: connection.encryptedRefreshToken,
        nonce: connection.encryptionNonce,
        tag: connection.encryptionTag,
        keyVersion: connection.encryptionKeyVersion,
      },
      `${connection.organizationId}:${connection.id}`,
    );
  } catch {
    throw new ProviderError("UNAUTHORIZED");
  }
  let config: ReturnType<typeof readSpApiConfig>;
  try {
    config = readSpApiConfig();
  } catch {
    throw new ProviderError("INVALID_REQUEST");
  }
  const tokens = new LwaAccessTokenProvider(config, refreshToken);
  return {
    provider: new AmazonSpApiProvider(
      config,
      Object.assign(() => tokens.getAccessToken(), {
        invalidate: () => tokens.invalidate(),
      }),
    ),
    providerKind: "AMAZON_SP_API",
    marketplace: {
      marketplaceId: connection.marketplaceId,
      region: connection.region,
      sellerId: connection.sellerId,
      connectionId: connection.id,
    },
  };
}
