import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  AmazonConnectionError,
  continueAmazonAuthorizationState,
  consumeAmazonAuthorizationState,
  createAmazonAuthorizationState,
  db,
  disconnectAmazonConnection,
  getAmazonIntegrationStatus,
  getCatalogProviderConnection,
  persistAmazonMarketplaceParticipations,
  requestAmazonConnectionJob,
  setDefaultAmazonMarketplace,
} from "../../packages/database/src/index.js";

const suffix = randomUUID();
const [organizationA, organizationB] = await Promise.all([
  db.organization.create({
    data: { slug: `amazon-a-${suffix}`, name: "Amazon tenant A" },
  }),
  db.organization.create({
    data: { slug: `amazon-b-${suffix}`, name: "Amazon tenant B" },
  }),
]);
const organizations = [organizationA.id, organizationB.id];

try {
  await assert.rejects(
    consumeAmazonAuthorizationState({
      stateHash: `wrong-${suffix}`,
      encryptedOauthCode: "encrypted-fixture",
      oauthCodeKeyVersion: 1,
      sellerId: "seller-a",
    }),
    (error: unknown) =>
      error instanceof AmazonConnectionError &&
      error.code === "OAUTH_STATE_INVALID",
  );

  await createAmazonAuthorizationState({
    organizationId: organizationA.id,
    stateHash: `expired-${suffix}`,
    marketplaceId: "ATVPDKIKX0DER",
    region: "NA",
    returnPath: "/settings/integrations/amazon",
    expiresAt: new Date("2026-08-21T00:00:00.000Z"),
  });
  await assert.rejects(
    consumeAmazonAuthorizationState({
      stateHash: `expired-${suffix}`,
      encryptedOauthCode: "encrypted-fixture",
      oauthCodeKeyVersion: 1,
      sellerId: "seller-a",
      now: new Date("2026-08-22T00:00:00.000Z"),
    }),
    (error: unknown) =>
      error instanceof AmazonConnectionError &&
      error.code === "OAUTH_STATE_EXPIRED",
  );

  await createAmazonAuthorizationState({
    organizationId: organizationA.id,
    stateHash: `seller-original-${suffix}`,
    marketplaceId: "ATVPDKIKX0DER",
    region: "NA",
    returnPath: "/settings/integrations/amazon",
    expiresAt: new Date("2026-08-23T00:00:00.000Z"),
  });
  await continueAmazonAuthorizationState({
    organizationId: organizationA.id,
    stateHash: `seller-confirm-${suffix}`,
    sellerId: "seller-a",
    now: new Date("2026-08-22T00:00:00.000Z"),
  });
  await assert.rejects(
    consumeAmazonAuthorizationState({
      stateHash: `seller-confirm-${suffix}`,
      encryptedOauthCode: "encrypted-fixture",
      oauthCodeKeyVersion: 1,
      sellerId: "seller-b",
      now: new Date("2026-08-22T00:01:00.000Z"),
    }),
    (error: unknown) =>
      error instanceof AmazonConnectionError &&
      error.code === "OAUTH_SELLER_MISMATCH",
  );

  await createAmazonAuthorizationState({
    organizationId: organizationA.id,
    stateHash: `valid-${suffix}`,
    marketplaceId: "ATVPDKIKX0DER",
    region: "NA",
    returnPath: "/settings/integrations/amazon",
    expiresAt: new Date("2026-08-23T00:00:00.000Z"),
  });
  const consumed = await consumeAmazonAuthorizationState({
    stateHash: `valid-${suffix}`,
    encryptedOauthCode: "encrypted-fixture",
    oauthCodeKeyVersion: 1,
    sellerId: "seller-a",
    now: new Date("2026-08-22T00:00:00.000Z"),
  });
  assert.ok(consumed.jobId);
  await assert.rejects(
    consumeAmazonAuthorizationState({
      stateHash: `valid-${suffix}`,
      encryptedOauthCode: "encrypted-fixture-replay",
      oauthCodeKeyVersion: 1,
      sellerId: "seller-a",
      now: new Date("2026-08-22T00:01:00.000Z"),
    }),
    (error: unknown) =>
      error instanceof AmazonConnectionError &&
      error.code === "OAUTH_STATE_REPLAYED",
  );

  const connection = await db.providerConnection.create({
    data: {
      organizationId: organizationA.id,
      provider: "AMAZON_SP_API",
      mode: "SELF_AUTHORIZED",
      status: "ACTIVE",
      sellerId: "seller-a",
      marketplaceId: "ATVPDKIKX0DER",
      region: "NA",
      encryptedRefreshToken: "encrypted-refresh-fixture",
      encryptionNonce: "nonce-fixture",
      encryptionTag: "tag-fixture",
      encryptionKeyVersion: 1,
      authorizedAt: new Date("2026-08-22T00:00:00.000Z"),
    },
  });
  await persistAmazonMarketplaceParticipations({
    organizationId: organizationA.id,
    connectionId: connection.id,
    observedAt: new Date("2026-08-22T01:00:00.000Z"),
    preferredMarketplaceId: "ATVPDKIKX0DER",
    participations: [
      {
        marketplaceId: "ATVPDKIKX0DER",
        name: "Amazon.com",
        countryCode: "US",
        domainName: "www.amazon.com",
        defaultCurrencyCode: "USD",
        defaultLanguageCode: "en_US",
        isParticipating: true,
        hasSuspendedListings: false,
      },
      {
        marketplaceId: "A2EUQ1WTGCTBG2",
        name: "Amazon.ca",
        countryCode: "CA",
        domainName: "www.amazon.ca",
        defaultCurrencyCode: "CAD",
        defaultLanguageCode: "en_CA",
        isParticipating: true,
        hasSuspendedListings: false,
      },
    ],
  });
  assert.equal(await getAmazonIntegrationStatus(organizationB.id), null);
  await assert.rejects(
    requestAmazonConnectionJob({
      organizationId: organizationB.id,
      connectionId: connection.id,
      kind: "VALIDATE",
    }),
    /CONNECTION_NOT_FOUND/,
  );
  await assert.rejects(
    setDefaultAmazonMarketplace({
      organizationId: organizationB.id,
      connectionId: connection.id,
      marketplaceId: "A2EUQ1WTGCTBG2",
    }),
    /MARKETPLACE_NOT_AVAILABLE/,
  );
  await setDefaultAmazonMarketplace({
    organizationId: organizationA.id,
    connectionId: connection.id,
    marketplaceId: "A2EUQ1WTGCTBG2",
  });
  const status = await getAmazonIntegrationStatus(organizationA.id);
  assert.equal(status?.mode, "SELF_AUTHORIZED");
  assert.equal(
    status?.marketplaces.find((item) => item.isDefault)?.marketplaceId,
    "A2EUQ1WTGCTBG2",
  );

  process.env.PHASE_ZERO_DEMO_MODE = "true";
  process.env.PROVIDER_MODE = "mock";
  await disconnectAmazonConnection({
    organizationId: organizationA.id,
    connectionId: connection.id,
  });
  const revoked = await db.providerConnection.findUniqueOrThrow({
    where: { id: connection.id },
  });
  assert.equal(revoked.status, "REVOKED");
  assert.equal(revoked.encryptedRefreshToken, null);
  assert.equal(await getCatalogProviderConnection(organizationA.id), null);

  process.stdout.write("amazon connection integration: ok\n");
} finally {
  await db.outboxEvent.deleteMany({
    where: { organizationId: { in: organizations } },
  });
  await db.workflowAuditEvent.deleteMany({
    where: { organizationId: { in: organizations } },
  });
  await db.providerConnectionJob.deleteMany({
    where: { organizationId: { in: organizations } },
  });
  await db.providerAuthorizationState.deleteMany({
    where: { organizationId: { in: organizations } },
  });
  await db.providerEntitlement.deleteMany({
    where: { organizationId: { in: organizations } },
  });
  await db.providerConnection.deleteMany({
    where: { organizationId: { in: organizations } },
  });
  await db.organization.deleteMany({ where: { id: { in: organizations } } });
  await db.$disconnect();
}
