import { randomUUID } from "node:crypto";
import {
  LwaAccessTokenProvider,
  SpApiConfigurationError,
  SpApiTransport,
  readSpApiConnectionConfig,
  testSpApiConnection,
  vaultFromEnvironment,
} from "@rizpoint/amazon-sp-api";
import { db } from "@rizpoint/database";

async function main() {
  const config = readSpApiConnectionConfig();
  const organizationSlug =
    process.env.RIZPOINT_PRIVATE_ORGANIZATION_SLUG?.trim();
  if (!organizationSlug) throw new Error("MISSING_ORGANIZATION_SLUG");
  const vault = vaultFromEnvironment();
  if (!vault) throw new Error("MISSING_CREDENTIAL_ENCRYPTION_KEY");
  const organization = await db.organization.findUnique({
    where: { slug: organizationSlug },
  });
  if (!organization) throw new Error("ORGANIZATION_NOT_FOUND");

  const current = await db.providerConnection.findUnique({
    where: {
      organizationId_provider_marketplaceId: {
        organizationId: organization.id,
        provider: "AMAZON_SP_API",
        marketplaceId: config.marketplaceId,
      },
    },
  });
  const connectionId = current?.id ?? randomUUID();
  const encrypted = vault.encrypt(
    config.refreshToken,
    `${organization.id}:${connectionId}`,
  );
  const tokens = new LwaAccessTokenProvider(config, config.refreshToken);
  const health = await testSpApiConnection(
    new SpApiTransport(
      config,
      Object.assign(() => tokens.getAccessToken(), {
        invalidate: () => tokens.invalidate(),
      }),
    ),
  );
  const status =
    health.status === "CONNECTED"
      ? "ACTIVE"
      : health.status === "UNAUTHORIZED"
        ? "AUTH_REQUIRED"
        : "ERROR";
  await db.providerConnection.upsert({
    where: {
      organizationId_provider_marketplaceId: {
        organizationId: organization.id,
        provider: "AMAZON_SP_API",
        marketplaceId: config.marketplaceId,
      },
    },
    create: {
      id: connectionId,
      organizationId: organization.id,
      provider: "AMAZON_SP_API",
      mode: "SELF_AUTHORIZED",
      status,
      sellerId: config.sellerId,
      marketplaceId: config.marketplaceId,
      region: config.region,
      encryptedRefreshToken: encrypted.ciphertext,
      encryptionNonce: encrypted.nonce,
      encryptionTag: encrypted.tag,
      encryptionKeyVersion: encrypted.keyVersion,
      authorizedAt: new Date(),
      lastValidatedAt: new Date(health.checkedAt),
      ...(health.status === "CONNECTED" ? { lastSuccessAt: new Date() } : {}),
      ...(health.lastErrorCode ? { lastErrorCode: health.lastErrorCode } : {}),
    },
    update: {
      mode: "SELF_AUTHORIZED",
      status,
      sellerId: config.sellerId,
      region: config.region,
      encryptedRefreshToken: encrypted.ciphertext,
      encryptionNonce: encrypted.nonce,
      encryptionTag: encrypted.tag,
      encryptionKeyVersion: encrypted.keyVersion,
      authorizedAt: new Date(),
      lastValidatedAt: new Date(health.checkedAt),
      lastSuccessAt: health.status === "CONNECTED" ? new Date() : null,
      lastErrorCode: health.lastErrorCode ?? null,
    },
  });
  // Deliberately report only the normalized status; never print identifiers or credentials.
  process.stdout.write(`SP_API_CONNECTION_STATUS=${health.status}\n`);
  if (health.status !== "CONNECTED") process.exitCode = 1;
}

main()
  .catch((error: unknown) => {
    const code =
      error instanceof SpApiConfigurationError
        ? error.code
        : "SP_API_CONNECTION_FAILED";
    process.stderr.write(`SP_API_CONNECTION_ERROR=${code}\n`);
    process.exitCode = 1;
  })
  .finally(async () => db.$disconnect());
