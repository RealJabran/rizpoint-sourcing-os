import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  db,
  getProviderUsageSummary,
  upsertProviderEntitlement,
} from "../../packages/database/src/index.js";
import { ProviderError } from "../../packages/provider-contracts/dist/index.js";
import { accessProviderData } from "../../apps/worker/src/provider-data-access.js";

const suffix = randomUUID();
const marketplaceA = "ATVPDKIKX0DER";
const marketplaceB = "A2EUQ1WTGCTBG2";
const providerKey = `memory-fixture-${suffix}`;
const request = {
  operation: "getCatalogItem",
  asin: "B000000001",
  includedData: ["identifiers", "attributes", "salesRanks"],
};
const policy = {
  capability: "CATALOG" as const,
  freshForSeconds: 60,
  staleWhileRevalidateSeconds: 60,
  retainForSeconds: 3_600,
};
const organizations = await Promise.all([
  db.organization.create({
    data: { slug: `memory-a-${suffix}`, name: "Memory fixture A" },
  }),
  db.organization.create({
    data: { slug: `memory-b-${suffix}`, name: "Memory fixture B" },
  }),
]);
const organizationA = organizations[0]!;
const organizationB = organizations[1]!;

let providerCalls = 0;
let observationSequence = 0;
let nextCompleteness: "COMPLETE" | "PARTIAL" = "COMPLETE";
let nextObservedAt = new Date("2026-08-22T10:00:00.000Z");

async function entitlement(organizationId: string, marketplaceId: string) {
  await upsertProviderEntitlement({
    organizationId,
    providerKey,
    marketplaceId,
    capability: "CATALOG",
    mode: "LIVE",
    state: "HEALTHY",
    completeness: "COMPLETE",
    checkedAt: new Date("2026-08-22T09:00:00.000Z"),
  });
}

async function research(input: {
  organizationId: string;
  marketplaceId: string;
  now: Date;
  forceRefresh?: boolean;
  fetchDelayMs?: number;
  requestSuffix?: string;
  allowStale?: boolean;
  scheduleRefresh?: () => Promise<void>;
}) {
  const scopedRequest = {
    ...request,
    ...(input.requestSuffix ? { requestSuffix: input.requestSuffix } : {}),
  };
  return accessProviderData({
    organizationId: input.organizationId,
    providerKey,
    marketplaceId: input.marketplaceId,
    capability: "CATALOG",
    operation: "getCatalogItem",
    request: scopedRequest,
    mode: "LIVE",
    policy,
    now: input.now,
    ...(input.forceRefresh === undefined
      ? {}
      : { forceRefresh: input.forceRefresh }),
    ...(input.allowStale === undefined ? {} : { allowStale: input.allowStale }),
    ...(input.scheduleRefresh
      ? { scheduleRefresh: input.scheduleRefresh }
      : {}),
    parse: (projection) => {
      if (!projection || typeof projection !== "object")
        throw new ProviderError("INVALID_RESPONSE");
      return projection as {
        asin: string;
        title: string;
        observationSequence: number;
      };
    },
    fetch: async () => {
      providerCalls += 1;
      if (input.fetchDelayMs)
        await new Promise((resolve) => setTimeout(resolve, input.fetchDelayMs));
      observationSequence += 1;
      return {
        projection: {
          asin: request.asin,
          title: `Stored catalog identity ${observationSequence}`,
          observationSequence,
        },
        observedAt: nextObservedAt,
        completeness: nextCompleteness,
      };
    },
    persistEvidence: async (result) => {
      await db.researchObservation.create({
        data: {
          organizationId: input.organizationId,
          marketplaceId: input.marketplaceId,
          type: "PRODUCT_MARKET",
          providerKey,
          operation: "getCatalogItem",
          observationKey: `${request.asin}:${observationSequence}`,
          providerReference: request.asin,
          observedAt: result.observedAt,
          expiresAt: new Date(result.observedAt.getTime() + 60_000),
          freshnessState: "FRESH",
          completeness: result.completeness,
          status: result.completeness === "COMPLETE" ? "SUCCESS" : "PARTIAL",
        },
      });
    },
  });
}

try {
  await Promise.all([
    entitlement(organizationA.id, marketplaceA),
    entitlement(organizationA.id, marketplaceB),
    entitlement(organizationB.id, marketplaceA),
  ]);
  const product = await db.catalogProduct.create({
    data: {
      provider: "AMAZON_SP_API",
      providerReference: `memory-${suffix}`,
      asin: request.asin,
      title: "Stored catalog identity",
      marketplaceId: marketplaceA,
      observedAt: nextObservedAt,
      freshnessState: "FRESH",
      identityProjection: {
        attributes: { color: "Fixture green" },
        salesRanks: [{ category: "fixture", rank: 42 }],
      },
      identifiers: {
        create: [
          { type: "ASIN", value: request.asin },
          { type: "UPC", value: "000000000001" },
        ],
      },
    },
  });
  assert.equal(
    await db.productIdentifier.count({
      where: { catalogProductId: product.id },
    }),
    2,
  );

  // RUN 1: live fetch and durable evidence/cache persistence.
  const run1 = await research({
    organizationId: organizationA.id,
    marketplaceId: marketplaceA,
    now: new Date("2026-08-22T10:00:00.000Z"),
  });
  assert.equal(run1.source, "PROVIDER");
  assert.equal(providerCalls, 1);

  // RUN 2: same exact scoped request hydrates PostgreSQL and calls nothing.
  const run2 = await research({
    organizationId: organizationA.id,
    marketplaceId: marketplaceA,
    now: new Date("2026-08-22T10:00:30.000Z"),
  });
  assert.equal(run2.source, "PERSISTED_FRESH");
  assert.deepEqual(run2.projection, run1.projection);
  assert.equal(providerCalls, 1);

  // Simulate worker/web restart: disconnect the shared client. The next access
  // reconnects and must still use PostgreSQL, proving there is no process cache.
  await db.$disconnect();
  const run3 = await research({
    organizationId: organizationA.id,
    marketplaceId: marketplaceA,
    now: new Date("2026-08-22T10:00:45.000Z"),
  });
  assert.equal(run3.source, "PERSISTED_FRESH");
  assert.equal(providerCalls, 1);

  // RUN 4: expired cache calls again and appends rather than replacing evidence.
  nextObservedAt = new Date("2026-08-22T10:03:00.000Z");
  const run4 = await research({
    organizationId: organizationA.id,
    marketplaceId: marketplaceA,
    now: new Date("2026-08-22T10:03:00.000Z"),
  });
  assert.equal(run4.source, "PROVIDER");
  assert.equal(providerCalls, 2);
  assert.equal(
    await db.researchObservation.count({
      where: { organizationId: organizationA.id, marketplaceId: marketplaceA },
    }),
    2,
  );

  // Marketplace and organization are always part of the durable cache key.
  await research({
    organizationId: organizationA.id,
    marketplaceId: marketplaceB,
    now: new Date("2026-08-22T10:03:00.000Z"),
  });
  await research({
    organizationId: organizationB.id,
    marketplaceId: marketplaceA,
    now: new Date("2026-08-22T10:03:00.000Z"),
  });
  assert.equal(providerCalls, 4);

  // Forced refresh bypasses freshness but still traverses entitlement + lease.
  nextObservedAt = new Date("2026-08-22T10:03:10.000Z");
  const forced = await research({
    organizationId: organizationA.id,
    marketplaceId: marketplaceA,
    now: nextObservedAt,
    forceRefresh: true,
  });
  assert.equal(forced.cacheOutcome, "FORCED_REFRESH");
  assert.equal(providerCalls, 5);

  // Partial data remains partial; it is not silently upgraded to complete.
  nextCompleteness = "PARTIAL";
  nextObservedAt = new Date("2026-08-22T10:04:00.000Z");
  const partial = await research({
    organizationId: organizationA.id,
    marketplaceId: marketplaceA,
    now: nextObservedAt,
    requestSuffix: "partial",
  });
  assert.equal(partial.completeness, "PARTIAL");
  nextCompleteness = "COMPLETE";

  // Stale-while-refresh is opt-in, visibly stale, and schedules durable work.
  nextObservedAt = new Date("2026-08-22T10:04:10.000Z");
  await research({
    organizationId: organizationA.id,
    marketplaceId: marketplaceA,
    now: nextObservedAt,
    requestSuffix: "stale",
  });
  const callsBeforeStale = providerCalls;
  let scheduledRefreshes = 0;
  const stale = await research({
    organizationId: organizationA.id,
    marketplaceId: marketplaceA,
    now: new Date("2026-08-22T10:05:20.000Z"),
    requestSuffix: "stale",
    allowStale: true,
    scheduleRefresh: async () => {
      scheduledRefreshes += 1;
    },
  });
  assert.equal(stale.source, "PERSISTED_STALE");
  assert.equal(stale.refreshScheduled, true);
  assert.equal(providerCalls, callsBeforeStale);
  assert.equal(scheduledRefreshes, 1);

  // Concurrent misses collapse through the existing database lease.
  nextObservedAt = new Date("2026-08-22T10:07:00.000Z");
  const callsBeforeConcurrent = providerCalls;
  const concurrent = await Promise.all([
    research({
      organizationId: organizationA.id,
      marketplaceId: marketplaceA,
      now: nextObservedAt,
      requestSuffix: "concurrent",
      fetchDelayMs: 150,
    }),
    research({
      organizationId: organizationA.id,
      marketplaceId: marketplaceA,
      now: nextObservedAt,
      requestSuffix: "concurrent",
      fetchDelayMs: 150,
    }),
  ]);
  const concurrentCollapsedCalls = providerCalls - callsBeforeConcurrent;
  assert.equal(concurrentCollapsedCalls, 1);
  assert.ok(concurrent.some((result) => result.source === "COALESCED"));

  // Throttle is explicit and does not erase the prior cached projection.
  await assert.rejects(
    accessProviderData({
      organizationId: organizationA.id,
      providerKey,
      marketplaceId: marketplaceA,
      capability: "CATALOG",
      operation: "getCatalogItem",
      request: { ...request, requestSuffix: "throttle" },
      mode: "LIVE",
      policy,
      now: new Date("2026-08-22T10:08:00.000Z"),
      parse: (projection) => projection,
      fetch: async () => {
        providerCalls += 1;
        throw new ProviderError("THROTTLED", { retryAfterMs: 1_000 });
      },
    }),
    (error) => error instanceof ProviderError && error.code === "THROTTLED",
  );
  const usage = await getProviderUsageSummary({
    organizationId: organizationA.id,
    since: new Date("2026-08-22T09:00:00.000Z"),
  });
  console.log("provider memory measured usage", JSON.stringify(usage));
  assert.ok(usage.cacheHits >= 3);
  assert.ok(usage.cacheMisses >= 4);
  assert.ok(usage.refreshes >= 1);
  assert.ok(usage.throttles >= 1);

  console.log(
    JSON.stringify({
      providerMemory: "PASS",
      providerCalls,
      run1ProviderCalls: 1,
      run2ProviderCalls: 0,
      run3AfterRestartProviderCalls: 0,
      run4AfterExpiryProviderCalls: 1,
      cacheHits: usage.cacheHits,
      cacheMisses: usage.cacheMisses,
      refreshes: usage.refreshes,
      throttles: usage.throttles,
      staleHits: usage.staleHits,
      concurrentCollapsedCalls,
      priorEvidenceRetained: true,
      tenantMarketplaceIsolation: "PASS",
    }),
  );
} finally {
  const organizationIds = organizations.map(({ id }) => id);
  await db.providerRequestAttempt.deleteMany({
    where: { organizationId: { in: organizationIds } },
  });
  await db.providerRequestLease.deleteMany({
    where: { organizationId: { in: organizationIds } },
  });
  await db.providerCacheEntry.deleteMany({
    where: { organizationId: { in: organizationIds } },
  });
  await db.researchObservation.deleteMany({
    where: { organizationId: { in: organizationIds } },
  });
  await db.providerEntitlement.deleteMany({
    where: { organizationId: { in: organizationIds } },
  });
  await db.productIdentifier.deleteMany({
    where: { catalogProduct: { providerReference: `memory-${suffix}` } },
  });
  await db.catalogProduct.deleteMany({
    where: { providerReference: `memory-${suffix}` },
  });
  await db.organization.deleteMany({ where: { id: { in: organizationIds } } });
  await db.$disconnect();
}
