import { randomUUID } from "node:crypto";
import {
  LwaAccessTokenProvider,
  SpApiConfigurationError,
  SpApiTransport,
  getMarketplaceParticipations,
  readSpApiConnectionConfig,
  vaultFromEnvironment,
} from "@rizpoint/amazon-sp-api";
import {
  db,
  persistAmazonMarketplaceParticipations,
  requestAmazonConnectionJob,
} from "@rizpoint/database";

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
  const discovered = await getMarketplaceParticipations(
    new SpApiTransport(
      config,
      Object.assign(() => tokens.getAccessToken(), {
        invalidate: () => tokens.invalidate(),
      }),
    ),
  );
  const observedAt = new Date(discovered.observedAt);
  const connection = await db.providerConnection.upsert({
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
      status: "ACTIVE",
      sellerId: config.sellerId,
      marketplaceId: config.marketplaceId,
      region: config.region,
      encryptedRefreshToken: encrypted.ciphertext,
      encryptionNonce: encrypted.nonce,
      encryptionTag: encrypted.tag,
      encryptionKeyVersion: encrypted.keyVersion,
      authorizedAt: new Date(),
      lastValidatedAt: observedAt,
      lastSuccessAt: observedAt,
    },
    update: {
      mode: "SELF_AUTHORIZED",
      status: "ACTIVE",
      sellerId: config.sellerId,
      region: config.region,
      encryptedRefreshToken: encrypted.ciphertext,
      encryptionNonce: encrypted.nonce,
      encryptionTag: encrypted.tag,
      encryptionKeyVersion: encrypted.keyVersion,
      authorizedAt: new Date(),
      lastValidatedAt: observedAt,
      lastSuccessAt: observedAt,
      lastErrorCode: null,
      revokedAt: null,
    },
  });
  await db.securityAuditEvent.create({
    data: {
      organizationId: organization.id,
      eventType: "PROVIDER_CONNECTED",
      idempotencyKey: `security-self-authorized:${connection.id}:${observedAt.toISOString()}`,
      context: { provider: "AMAZON_SP_API", mode: "SELF_AUTHORIZED" },
    },
  });
  await persistAmazonMarketplaceParticipations({
    organizationId: organization.id,
    connectionId: connection.id,
    participations: discovered.participations,
    observedAt,
    preferredMarketplaceId: config.marketplaceId,
  });
  await requestAmazonConnectionJob({
    organizationId: organization.id,
    connectionId: connection.id,
    kind: "REFRESH_CAPABILITIES",
    idempotencyKey: `amazon-self-authorized-capabilities:${connection.id}:${observedAt.toISOString()}`,
  });
  await db.workflowAuditEvent.create({
    data: {
      organizationId: organization.id,
      entityType: "ProviderConnection",
      entityId: connection.id,
      eventType: "amazon.self_authorized_connected",
      payload: {
        mode: "SELF_AUTHORIZED",
        marketplaceCount: discovered.participations.length,
      },
    },
  });
  // Deliberately report only the normalized status; never print identifiers or credentials.
  process.stdout.write("SP_API_CONNECTION_STATUS=CONNECTED\n");
  process.stdout.write("SP_API_CAPABILITY_STATUS=QUEUED\n");
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
