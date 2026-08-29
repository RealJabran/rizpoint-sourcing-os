import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  amazonRetentionDeadline,
  completeAmazonDeletionRequest,
  createAmazonDeletionRequest,
  db,
  deleteAmazonInformationCandidates,
  listAmazonInformationCandidates,
  listExpiredHistoricalMetricPoints,
  listPendingAmazonDeletionScopes,
  putProviderCacheEntry,
  recordSecurityAuditEvent,
} from "../../packages/database/src/index.js";

const suffix = randomUUID();
const marketplaceId = "ATVPDKIKX0DER";
const observedAt = new Date("2025-01-31T00:00:00.000Z");
const now = new Date("2026-08-29T00:00:00.000Z");
const [organizationA, organizationB] = await Promise.all([
  db.organization.create({
    data: { slug: `retention-a-${suffix}`, name: "Retention tenant A" },
  }),
  db.organization.create({
    data: { slug: `retention-b-${suffix}`, name: "Retention tenant B" },
  }),
]);
const user = await db.user.create({
  data: {
    email: `retention-${suffix}@example.test`,
    displayName: "Retention Owner",
    passwordHash: "scrypt-v1$fixture$fixture",
    passwordExpiresAt: new Date("2027-08-29T00:00:00.000Z"),
    memberships: {
      create: { organizationId: organizationA.id, role: "OWNER" },
    },
  },
});
const entitlements = await Promise.all(
  [organizationA, organizationB].map((organization) =>
    db.providerEntitlement.create({
      data: {
        organizationId: organization.id,
        providerKey: "amazon-sp-api",
        marketplaceId,
        capability: "CATALOG",
        mode: "LIVE",
        state: "AUTHORIZED",
        checkedAt: observedAt,
        dataRetentionDays: 30,
      },
    }),
  ),
);

async function cache(
  organizationId: string,
  entitlementId: string,
  requestHash: string,
  rawEvidenceReference?: string,
) {
  return putProviderCacheEntry({
    organizationId,
    entitlementId,
    providerKey: "amazon-sp-api",
    marketplaceId,
    capability: "CATALOG",
    operation: "getCatalogItem",
    requestHash,
    normalizedProjection: { asin: "B000000001", title: "Retention fixture" },
    ...(rawEvidenceReference ? { rawEvidenceReference } : {}),
    observedAt,
    freshUntil: new Date("2025-02-01T00:00:00.000Z"),
    staleUntil: new Date("2025-02-02T00:00:00.000Z"),
    retainUntil: new Date("2030-01-01T00:00:00.000Z"),
    completeness: "COMPLETE",
  });
}

const cacheA = await cache(
  organizationA.id,
  entitlements[0]!.id,
  `cache-a-${suffix}`,
  `provider/${organizationA.id}/fixture.json`,
);
await cache(organizationB.id, entitlements[1]!.id, `cache-b-${suffix}`);
const [researchObservationA, researchObservationB] = await Promise.all(
  [organizationA, organizationB].map((organization) =>
    db.researchObservation.create({
      data: {
        organizationId: organization.id,
        marketplaceId,
        type: "PRODUCT_MARKET",
        providerKey: "amazon-sp-api",
        operation: "getCatalogItem",
        observationKey: `retention-${organization.id}-${suffix}`,
        providerReference: "B000000001",
        observedAt,
        freshnessState: "EXPIRED",
        completeness: "COMPLETE",
        status: "SUCCESS",
      },
    }),
  ),
);

// The write path cannot preserve a caller's longer date. Calendar semantics
// clamp 31 January + 18 months to 31 July, and the 30-day contract is shorter.
assert.equal(
  cacheA.entry.retainUntil.toISOString(),
  amazonRetentionDeadline({
    observedAt,
    requestedRetainUntil: new Date("2030-01-01T00:00:00.000Z"),
    shorterContractualRetentionDays: 30,
  }).toISOString(),
);
const candidates = await listAmazonInformationCandidates({
  organizationId: organizationA.id,
  now,
  limit: 1,
});
assert.equal(candidates.length, 1, "candidate batch must remain bounded");
assert.equal(candidates[0]!.organizationId, organizationA.id);
assert.equal(candidates[0]!.kind, "PROVIDER_CACHE");

const supplier = await db.supplier.create({
  data: {
    organizationId: organizationA.id,
    code: `supplier-${suffix}`,
    name: "Supplier data must survive",
  },
});
const securityEvent = await recordSecurityAuditEvent({
  organizationId: organizationA.id,
  actorUserId: user.id,
  eventType: "LOGIN_SUCCESS",
  context: { reason: "RETENTION_INTEGRATION_FIXTURE" },
  now,
});

// A record with an object is not removed until object deletion is confirmed.
const retryCounts = await deleteAmazonInformationCandidates({
  organizationId: organizationA.id,
  candidates,
  objectDeletionConfirmedIds: new Set(),
  now,
  reason: "RETENTION_EXPIRY",
});
assert.equal(retryCounts.PROVIDER_CACHE, 0);
assert.equal(
  await db.providerCacheEntry.count({
    where: { organizationId: organizationA.id },
  }),
  1,
);

const deleted = await deleteAmazonInformationCandidates({
  organizationId: organizationA.id,
  candidates,
  objectDeletionConfirmedIds: new Set([candidates[0]!.id]),
  now,
  reason: "RETENTION_EXPIRY",
});
assert.equal(deleted.PROVIDER_CACHE, 1);
const expiredObservationCandidates = await listAmazonInformationCandidates({
  organizationId: organizationA.id,
  now,
});
const expiredObservation = expiredObservationCandidates.find(
  (item) => item.id === researchObservationA.id,
);
assert.ok(expiredObservation, "expired Amazon observation must be selected");
const observationCounts = await deleteAmazonInformationCandidates({
  organizationId: organizationA.id,
  candidates: [expiredObservation],
  objectDeletionConfirmedIds: new Set(),
  now,
  reason: "RETENTION_EXPIRY",
});
assert.equal(observationCounts.RESEARCH_OBSERVATION, 1);
assert.equal(
  await db.researchObservation.count({
    where: { id: researchObservationB.id, organizationId: organizationB.id },
  }),
  1,
  "another tenant's research observation must survive",
);
assert.equal(
  await db.providerCacheEntry.count({
    where: { organizationId: organizationB.id },
  }),
  1,
  "another tenant's Amazon record must survive",
);
assert.equal(await db.supplier.count({ where: { id: supplier.id } }), 1);
assert.equal(
  await db.securityAuditEvent.count({ where: { id: securityEvent.id } }),
  1,
);

// Exercise the worker-startup history-retention query against PostgreSQL. The
// timestamp subtraction must be grouped before the comparison (not parsed as
// a timestamp/interval comparison).
const historySeries = await db.historicalMetricSeries.create({
  data: {
    organizationId: organizationB.id,
    marketplaceId,
    subjectType: "CATEGORY",
    subjectKey: `retention-category-${suffix}`,
    metricKey: "price",
    providerKey: "amazon-sp-api",
    unit: "currency",
    currency: "USD",
    retentionDays: 30,
  },
});
const historyPoint = await db.historicalMetricPoint.create({
  data: {
    organizationId: organizationB.id,
    seriesId: historySeries.id,
    sourceObservationId: researchObservationB.id,
    metricAt: observedAt,
    decimalValue: "19.99",
  },
});
assert.ok(
  (await listExpiredHistoricalMetricPoints(now)).some(
    (point) => point.id === historyPoint.id,
  ),
  "worker startup must be able to select expired historical points",
);

const connection = await db.providerConnection.create({
  data: {
    organizationId: organizationA.id,
    provider: "AMAZON_SP_API",
    mode: "SELF_AUTHORIZED",
    status: "ACTIVE",
    sellerId: "SELLER-REDACTED",
    marketplaceId,
    region: "NA",
    encryptedRefreshToken: "ciphertext-not-a-token",
    encryptionNonce: "nonce",
    encryptionTag: "tag",
    encryptionKeyVersion: 1,
  },
});
await db.providerCredential.create({
  data: {
    organizationId: organizationA.id,
    providerKey: "amazon-sp-api",
    credentialName: "private-fixture",
    ciphertext: "encrypted-fixture",
    encryptionNonce: "nonce",
    encryptionTag: "tag",
    encryptionKeyVersion: 1,
  },
});
const requestResult = await createAmazonDeletionRequest({
  organizationId: organizationA.id,
  requestedByUserId: user.id,
  reason: "AUTHORIZATION_REVOKED",
  requestedAt: now,
  idempotencyKey: `amazon-delete-${suffix}`,
});
assert.equal(requestResult.request.status, "SAFE_STATE");
assert.equal(
  requestResult.request.deadlineAt.toISOString(),
  "2026-09-28T00:00:00.000Z",
);
const revoked = await db.providerConnection.findUniqueOrThrow({
  where: { id: connection.id },
});
assert.equal(revoked.status, "REVOKED");
assert.equal(revoked.encryptedRefreshToken, null);
assert.equal(
  await db.providerCredential.count({
    where: { organizationId: organizationA.id, providerKey: "amazon-sp-api" },
  }),
  0,
);

await completeAmazonDeletionRequest({
  requestId: requestResult.request.id,
  organizationId: organizationA.id,
  deletedCounts: deleted,
  now,
});
const scopes = await listPendingAmazonDeletionScopes();
const tombstone = scopes.tombstones.find(
  (item) => item.organizationId === organizationA.id,
);
assert.ok(tombstone, "completion must persist a replay tombstone");

// Simulate an older backup restoring a covered cache row. Tombstone cutoff
// selection finds it and the same idempotent delete path removes it again.
const restored = await cache(
  organizationA.id,
  entitlements[0]!.id,
  `restored-${suffix}`,
);
const restoredCandidates = await listAmazonInformationCandidates({
  organizationId: organizationA.id,
  now,
  cutoffAt: tombstone.cutoffAt,
});
assert.ok(
  restoredCandidates.some((item) => item.id === restored.entry.id),
  "tombstone replay must find restored data through its cutoff",
);
await deleteAmazonInformationCandidates({
  organizationId: organizationA.id,
  candidates: restoredCandidates,
  objectDeletionConfirmedIds: new Set(
    restoredCandidates
      .filter((item) => item.objectReference)
      .map((item) => item.id),
  ),
  now,
  reason: "TOMBSTONE_REPLAY",
});
assert.equal(
  await db.providerCacheEntry.count({ where: { id: restored.entry.id } }),
  0,
);

console.log(
  JSON.stringify({
    amazonRetentionIntegration: "PASS",
    calendarMonths: 18,
    deletionDeadlineDays: 30,
    boundedDeletion: "PASS",
    objectDeleteRetry: "PASS",
    tenantIsolation: "PASS",
    tombstoneReplay: "PASS",
    securityLogPreserved: "PASS",
    supplierDataPreserved: "PASS",
    credentialSafeState: "PASS",
    workerStartupHistoryRetention: "PASS",
  }),
);
