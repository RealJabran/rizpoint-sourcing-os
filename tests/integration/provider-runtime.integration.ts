import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  claimProviderRequestLease,
  completeProviderRequestLease,
  createOrUpdateProviderRateBudget,
  db,
  ensureMockAmazonConnection,
  getProviderCacheEntry,
  listProviderCapabilityStates,
  providerCapabilityAvailability,
  putProviderCacheEntry,
  recordProviderRequestTelemetry,
  reserveProviderBudget,
  settleProviderBudgetReservation,
  storeEncryptedProviderCredential,
  upsertProviderEntitlement,
} from "../../packages/database/src/index.js";

const suffix = randomUUID();
const marketplaceId = "ATVPDKIKX0DER";
const [organizationA, organizationB] = await Promise.all([
  db.organization.create({
    data: { slug: `provider-runtime-a-${suffix}`, name: "Provider runtime A" },
  }),
  db.organization.create({
    data: { slug: `provider-runtime-b-${suffix}`, name: "Provider runtime B" },
  }),
]);

try {
  const credential = await storeEncryptedProviderCredential({
    organizationId: organizationA.id,
    providerKey: "licensed-fixture",
    credentialName: "api-token",
    ciphertext: "fixture-ciphertext-not-a-secret",
    encryptionNonce: "fixture-nonce",
    encryptionTag: "fixture-tag",
    encryptionKeyVersion: 1,
  });
  assert.equal("ciphertext" in credential, false);

  const checkedAt = new Date("2026-08-16T08:00:00.000Z");
  await upsertProviderEntitlement({
    organizationId: organizationA.id,
    providerKey: "licensed-fixture",
    marketplaceId,
    capability: "MARKET_HISTORY",
    mode: "LIVE",
    state: "AUTHORIZED",
    completeness: "UNKNOWN",
    checkedAt,
  });
  const entitlement = await db.providerEntitlement.findUniqueOrThrow({
    where: {
      organizationId_providerKey_marketplaceId_capability: {
        organizationId: organizationA.id,
        providerKey: "licensed-fixture",
        marketplaceId,
        capability: "MARKET_HISTORY",
      },
    },
  });
  const budget = await createOrUpdateProviderRateBudget({
    organizationId: organizationA.id,
    entitlementId: entitlement.id,
    unit: "CREDIT",
    windowStart: new Date("2026-08-16T00:00:00.000Z"),
    windowEnd: new Date("2026-08-17T00:00:00.000Z"),
    capacity: "2.0000",
    estimatedUnitCost: "0.12500000",
    costCurrency: "USD",
  });
  const reservation = await reserveProviderBudget({
    organizationId: organizationA.id,
    budgetId: budget.id,
    requestKey: `history:${suffix}`,
    units: "1.5000",
    expiresAt: new Date("2026-08-16T09:00:00.000Z"),
    now: checkedAt,
  });
  assert.equal(reservation.state, "RESERVED");
  assert.equal(reservation.duplicate, false);
  const retriedReservation = await reserveProviderBudget({
    organizationId: organizationA.id,
    budgetId: budget.id,
    requestKey: `history:${suffix}`,
    units: "1.5000",
    expiresAt: new Date("2026-08-16T09:00:00.000Z"),
    now: checkedAt,
  });
  assert.deepEqual(retriedReservation, {
    ...reservation,
    duplicate: true,
  });
  const exhausted = await reserveProviderBudget({
    organizationId: organizationA.id,
    budgetId: budget.id,
    requestKey: `history-extra:${suffix}`,
    units: "1.0000",
    expiresAt: new Date("2026-08-16T09:00:00.000Z"),
    now: checkedAt,
  });
  assert.equal(exhausted.state, "QUOTA_EXHAUSTED");
  assert.equal(exhausted.reason, "QUOTA_WINDOW_EXHAUSTED");
  assert.equal(
    (
      await providerCapabilityAvailability({
        organizationId: organizationA.id,
        providerKey: "licensed-fixture",
        marketplaceId,
        capability: "MARKET_HISTORY",
      })
    ).state,
    "QUOTA_EXHAUSTED",
  );
  assert.equal(
    (
      await providerCapabilityAvailability({
        organizationId: organizationB.id,
        providerKey: "licensed-fixture",
        marketplaceId,
        capability: "MARKET_HISTORY",
      })
    ).state,
    "NOT_CONFIGURED",
  );
  if (reservation.state !== "RESERVED") throw new Error("unreachable");
  const settled = await settleProviderBudgetReservation({
    organizationId: organizationA.id,
    reservationId: reservation.reservationId,
    outcome: "CONSUMED",
    now: new Date("2026-08-16T08:01:00.000Z"),
  });
  assert.equal(settled.duplicate, false);
  assert.equal(
    (
      await settleProviderBudgetReservation({
        organizationId: organizationA.id,
        reservationId: reservation.reservationId,
        outcome: "CONSUMED",
      })
    ).duplicate,
    true,
  );

  const expiringBudget = await createOrUpdateProviderRateBudget({
    organizationId: organizationA.id,
    entitlementId: entitlement.id,
    unit: "REQUEST",
    windowStart: new Date("2026-08-16T00:00:00.000Z"),
    windowEnd: new Date("2026-08-17T00:00:00.000Z"),
    capacity: "1.0000",
  });
  const expiring = await reserveProviderBudget({
    organizationId: organizationA.id,
    budgetId: expiringBudget.id,
    requestKey: `expiring:${suffix}`,
    units: "1.0000",
    expiresAt: new Date("2026-08-16T08:01:00.000Z"),
    now: checkedAt,
  });
  assert.equal(expiring.state, "RESERVED");
  const recovered = await reserveProviderBudget({
    organizationId: organizationA.id,
    budgetId: expiringBudget.id,
    requestKey: `after-expiry:${suffix}`,
    units: "1.0000",
    expiresAt: new Date("2026-08-16T09:00:00.000Z"),
    now: new Date("2026-08-16T08:02:00.000Z"),
  });
  assert.equal(recovered.state, "RESERVED");
  if (expiring.state !== "RESERVED") throw new Error("unreachable");
  assert.equal(
    (
      await db.providerBudgetReservation.findUniqueOrThrow({
        where: { id: expiring.reservationId },
      })
    ).status,
    "EXPIRED",
  );

  const concurrentBudget = await createOrUpdateProviderRateBudget({
    organizationId: organizationA.id,
    entitlementId: entitlement.id,
    unit: "TOKEN",
    windowStart: new Date("2026-08-16T00:00:00.000Z"),
    windowEnd: new Date("2026-08-17T00:00:00.000Z"),
    capacity: "1.0000",
  });
  const concurrentReservations = await Promise.all([
    reserveProviderBudget({
      organizationId: organizationA.id,
      budgetId: concurrentBudget.id,
      requestKey: `concurrent:${suffix}`,
      units: "1.0000",
      expiresAt: new Date("2026-08-16T09:00:00.000Z"),
      now: checkedAt,
    }),
    reserveProviderBudget({
      organizationId: organizationA.id,
      budgetId: concurrentBudget.id,
      requestKey: `concurrent:${suffix}`,
      units: "1.0000",
      expiresAt: new Date("2026-08-16T09:00:00.000Z"),
      now: checkedAt,
    }),
  ]);
  assert.deepEqual(
    concurrentReservations
      .map((item) => (item.state === "RESERVED" ? item.duplicate : item.state))
      .sort(),
    [false, true],
  );

  const cacheKey = {
    organizationId: organizationA.id,
    providerKey: "licensed-fixture",
    marketplaceId,
    capability: "MARKET_HISTORY" as const,
    operation: "history",
    requestHash: `sha256:${suffix}`,
  };
  await putProviderCacheEntry({
    ...cacheKey,
    entitlementId: entitlement.id,
    normalizedProjection: { pointsReturned: 2, absentMetric: null },
    rawEvidenceReference: `private/provider/${suffix}`,
    observedAt: new Date("2026-08-16T08:00:00.000Z"),
    freshUntil: new Date("2026-08-16T09:00:00.000Z"),
    staleUntil: new Date("2026-08-16T10:00:00.000Z"),
    retainUntil: new Date("2026-09-16T08:00:00.000Z"),
    completeness: "PARTIAL",
  });
  await putProviderCacheEntry({
    ...cacheKey,
    normalizedProjection: { pointsReturned: 0 },
    observedAt: new Date("2026-08-16T07:00:00.000Z"),
    freshUntil: new Date("2026-08-16T08:00:00.000Z"),
    staleUntil: new Date("2026-08-16T09:00:00.000Z"),
    retainUntil: new Date("2026-09-16T07:00:00.000Z"),
    completeness: "COMPLETE",
  });
  const cache = await getProviderCacheEntry({
    ...cacheKey,
    now: new Date("2026-08-16T09:30:00.000Z"),
  });
  assert.equal(cache.outcome, "STALE_HIT");
  assert.equal(cache.completeness, "PARTIAL");
  assert.deepEqual(cache.normalizedProjection, {
    pointsReturned: 2,
    absentMetric: null,
  });
  assert.equal(
    (
      await getProviderCacheEntry({
        ...cacheKey,
        organizationId: organizationB.id,
      })
    ).outcome,
    "MISS",
  );

  const leaseClaims = await Promise.all([
    claimProviderRequestLease({
      ...cacheKey,
      ownerTokenHash: `owner-a-${suffix}`,
      leaseExpiresAt: new Date("2026-08-16T08:05:00.000Z"),
      now: checkedAt,
    }),
    claimProviderRequestLease({
      ...cacheKey,
      ownerTokenHash: `owner-b-${suffix}`,
      leaseExpiresAt: new Date("2026-08-16T08:05:00.000Z"),
      now: checkedAt,
    }),
  ]);
  assert.deepEqual(leaseClaims.map((claim) => claim.claimed).sort(), [
    false,
    true,
  ]);
  const leaseOwner = leaseClaims.find((claim) => claim.claimed)?.lease
    .ownerTokenHash;
  assert.ok(leaseOwner);
  await completeProviderRequestLease({
    ...cacheKey,
    ownerTokenHash: leaseOwner,
    now: new Date("2026-08-16T08:02:00.000Z"),
  });

  const telemetryInput = {
    organizationId: organizationA.id,
    entitlementId: entitlement.id,
    providerKey: "licensed-fixture",
    marketplaceId,
    capability: "MARKET_HISTORY" as const,
    operation: "history",
    requestHash: `sha256:${suffix}`,
    mode: "LIVE" as const,
    state: "THROTTLED" as const,
    attempt: 1,
    startedAt: checkedAt,
    retryAt: new Date("2026-08-16T08:02:00.000Z"),
    errorCode: "THROTTLED",
    cost: { unit: "CREDIT" as const, estimatedUnits: "1.5000" },
  };
  await recordProviderRequestTelemetry(telemetryInput);
  await recordProviderRequestTelemetry({
    ...telemetryInput,
    state: "HEALTHY",
    completedAt: new Date("2026-08-16T08:02:00.000Z"),
  });
  assert.equal(
    await db.providerRequestAttempt.count({
      where: { organizationId: organizationA.id },
    }),
    1,
  );
  const states = await listProviderCapabilityStates({
    organizationId: organizationA.id,
    providerKey: "licensed-fixture",
  });
  assert.equal(states.length, 1);
  assert.equal("ciphertext" in states[0]!, false);

  const mockConnection = await ensureMockAmazonConnection(organizationA.id);
  const mockCatalog = await db.providerEntitlement.findUniqueOrThrow({
    where: {
      organizationId_providerKey_marketplaceId_capability: {
        organizationId: organizationA.id,
        providerKey: "mock-amazon",
        marketplaceId,
        capability: "CATALOG",
      },
    },
  });
  await db.providerEntitlement.update({
    where: { id: mockCatalog.id },
    data: {
      state: "QUOTA_EXHAUSTED",
      reasonCode: "QUOTA_WINDOW_EXHAUSTED",
      retryAt: new Date("2099-01-01T00:00:00.000Z"),
    },
  });
  await ensureMockAmazonConnection(organizationA.id);
  assert.equal(
    (
      await providerCapabilityAvailability({
        organizationId: organizationA.id,
        providerKey: "mock-amazon",
        marketplaceId: mockConnection.marketplaceId,
        capability: "CATALOG",
      })
    ).state,
    "QUOTA_EXHAUSTED",
  );

  console.log(
    JSON.stringify({
      tenantIsolation: "PASS",
      budgetIdempotency: "PASS",
      quotaVisibility: "PASS",
      quotaRecovery: "PASS",
      cacheFreshness: "PASS",
      requestDeduplication: "PASS",
      telemetryRedaction: "PASS",
    }),
  );
} finally {
  const organizationIds = [organizationA.id, organizationB.id];
  await db.providerRequestAttempt.deleteMany({
    where: { organizationId: { in: organizationIds } },
  });
  await db.providerRequestLease.deleteMany({
    where: { organizationId: { in: organizationIds } },
  });
  await db.providerCacheEntry.deleteMany({
    where: { organizationId: { in: organizationIds } },
  });
  await db.providerBudgetReservation.deleteMany({
    where: { organizationId: { in: organizationIds } },
  });
  await db.providerRateBudget.deleteMany({
    where: { organizationId: { in: organizationIds } },
  });
  await db.providerEntitlement.deleteMany({
    where: { organizationId: { in: organizationIds } },
  });
  await db.providerCredential.deleteMany({
    where: { organizationId: { in: organizationIds } },
  });
  await db.providerConnection.deleteMany({
    where: { organizationId: { in: organizationIds } },
  });
  await db.organization.deleteMany({ where: { id: { in: organizationIds } } });
  await db.$disconnect();
}
