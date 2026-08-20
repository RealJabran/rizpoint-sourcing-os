import { createHash, randomUUID } from "node:crypto";
import { Decimal } from "decimal.js";
import {
  claimHistoryRefreshRun,
  claimProviderRequestLease,
  batchWindows,
  completeHistoryRefreshItem,
  completeHistoryRefreshRun,
  completeProviderRequestLease,
  createResearchRepository,
  findActiveProviderRateBudget,
  getProviderCacheEntry,
  HISTORY_POINT_WRITE_BATCH_SIZE,
  putProviderCacheEntry,
  recordProviderRequestTelemetry,
  reserveProviderBudget,
  settleProviderBudgetReservation,
  syntheticFixtureDataRights,
  upsertProviderEntitlement,
} from "@rizpoint/database";
import { putPrivateObject } from "@rizpoint/object-storage";
import {
  marketHistoryBatchSchema,
  type MarketHistoryPoint,
  type MarketHistoryProduct,
  ProviderError,
} from "@rizpoint/provider-contracts";
import { DEFAULT_PROVIDER_FRESHNESS_POLICIES } from "@rizpoint/provider-contracts/runtime-policy";
import { createMarketHistoryProvider } from "./market-history-provider.js";
import { calculateHistoryAnalytics } from "./history-analytics.js";
import { mapWithConcurrency } from "./bounded-concurrency.js";
import { providerError, providerRetryDeadline } from "./enrichment-policy.js";

const policy = DEFAULT_PROVIDER_FRESHNESS_POLICIES.MARKET_HISTORY;
export const HISTORY_PROVIDER_BATCH_LIMIT = 100;
export const HISTORY_PERSIST_CONCURRENCY = 4;

export function planHistoryProviderBatch(asins: readonly string[]) {
  const unique = [...new Set(asins)].sort();
  if (!unique.length || unique.length > HISTORY_PROVIDER_BATCH_LIMIT)
    throw new Error("HISTORY_PROVIDER_BATCH_LIMIT");
  return unique;
}

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function historyRequest(asins: readonly string[], historyDays: number) {
  return {
    operation: "getProductHistory",
    asins: [...asins].sort(),
    historyDays,
    includeRatingAndReviews: true,
  };
}

/** Keepa's charge varies by requested product data. A live tenant must set a
 * conservative licensed-plan estimate instead of inheriting an invented one. */
export function keepaHistoryTokenEstimate(
  count: number,
  configured = process.env.KEEPA_HISTORY_TOKEN_ESTIMATE_PER_ASIN,
): string | null {
  if (!configured || !/^\d+(?:\.\d{1,4})?$/.test(configured)) return null;
  const perAsin = new Decimal(configured);
  if (
    !perAsin.isFinite() ||
    perAsin.lte(0) ||
    !Number.isInteger(count) ||
    count < 1
  )
    return null;
  return perAsin.times(count).toFixed(4);
}

function sanitiseEvidence(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitiseEvidence);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
      key,
      /(?:api.?key|authorization|token|secret|password)/i.test(key)
        ? "[REDACTED]"
        : sanitiseEvidence(nested),
    ]),
  );
}

function pointValue(point: MarketHistoryPoint) {
  if (point.decimalValue !== undefined)
    return { decimalValue: point.decimalValue } as const;
  if (point.integerValue !== undefined)
    return { integerValue: point.integerValue } as const;
  if (point.booleanValue !== undefined)
    return { booleanValue: point.booleanValue } as const;
  return { textValue: point.textValue! } as const;
}

async function persistProduct(input: {
  organizationId: string;
  item: { id: string; asin: string; catalogProductId: string | null };
  product: MarketHistoryProduct;
  requestHash: string;
  requestInputs: ReturnType<typeof historyRequest>;
  providerKey: string;
  observedAt: Date;
  freshUntil: Date;
  rawEvidenceReference?: string;
  retentionDays: number;
}) {
  if (!input.item.catalogProductId)
    throw new Error("HISTORY_CATALOG_PRODUCT_MISSING");
  const repository = createResearchRepository();
  const observation = await repository.recordHistoryObservation({
    envelope: {
      organizationId: input.organizationId,
      marketplaceId: input.product.marketplaceId,
      type: "HISTORY",
      providerKey: input.providerKey,
      operation: "getProductHistory",
      observationKey: `${input.requestHash}:${input.product.asin}`,
      providerReference: input.product.asin,
      observedAt: input.observedAt,
      expiresAt: input.freshUntil,
      freshnessState: "FRESH",
      completeness: input.product.completeness,
      status: input.product.completeness === "COMPLETE" ? "SUCCESS" : "PARTIAL",
      requestHash: input.requestHash,
      requestInputs: input.requestInputs,
      ...(input.rawEvidenceReference
        ? { rawEvidenceReference: input.rawEvidenceReference }
        : {}),
    },
  });
  for (const series of input.product.series) {
    const persisted = await repository.createHistoricalMetricSeries({
      organizationId: input.organizationId,
      marketplaceId: input.product.marketplaceId,
      subjectType: "PRODUCT",
      subjectKey: input.product.asin,
      catalogProductId: input.item.catalogProductId,
      metricKey: series.metricKey,
      providerKey: input.providerKey,
      unit: series.unit,
      ...(series.currency ? { currency: series.currency } : {}),
      retentionDays: input.retentionDays,
    });
    for (const window of batchWindows(
      series.points.length,
      HISTORY_POINT_WRITE_BATCH_SIZE,
    ))
      await repository.appendHistoricalMetricPoints({
        organizationId: input.organizationId,
        seriesId: persisted.id,
        sourceObservationId: observation.id,
        points: series.points
          .slice(window.offset, window.offset + window.limit)
          .map((point) => ({
            metricAt: new Date(point.observedAt),
            value: pointValue(point),
          })),
      });
  }
  await completeHistoryRefreshItem({
    organizationId: input.organizationId,
    itemId: input.item.id,
    status: input.product.completeness === "COMPLETE" ? "COMPLETED" : "PARTIAL",
    observationId: observation.id,
    ...(input.rawEvidenceReference
      ? { rawEvidenceReference: input.rawEvidenceReference }
      : {}),
  });
}

/** Refreshes at most 100 scan-owned ASINs. It writes only normalized points to
 * the research history tables; opaque evidence stays private and expires with
 * the provider cache retention window. */
export async function processHistoryRefresh(runId: string): Promise<void> {
  const run = await claimHistoryRefreshRun(runId);
  if (!run) return;
  const marketplace = {
    marketplaceId: run.marketplaceId,
    region: "NA" as const,
  };
  const asins = planHistoryProviderBatch(run.items.map((item) => item.asin));
  const requestInputs = historyRequest(asins, run.historyDays);
  const requestHash = hash(requestInputs);
  const now = new Date();
  const freshUntil = new Date(now.getTime() + policy.freshForSeconds * 1_000);
  const staleUntil = new Date(
    freshUntil.getTime() + policy.staleWhileRevalidateSeconds * 1_000,
  );
  let retainUntil = new Date(now.getTime() + policy.retainForSeconds * 1_000);
  let bundle: Awaited<ReturnType<typeof createMarketHistoryProvider>>;
  try {
    bundle = await createMarketHistoryProvider({
      organizationId: run.organizationId,
      marketplace,
    });
  } catch (error) {
    const detail = providerError(error);
    const status =
      detail.code === "UNAUTHORIZED" || detail.code === "FORBIDDEN"
        ? "UNAUTHORIZED"
        : "UNAVAILABLE";
    for (const item of run.items)
      await completeHistoryRefreshItem({
        organizationId: run.organizationId,
        itemId: item.id,
        status,
        errorCode: detail.code,
      });
    await completeHistoryRefreshRun({
      runId: run.id,
      errorCode: detail.code,
    });
    return;
  }
  const capabilityState = await upsertProviderEntitlement({
    organizationId: run.organizationId,
    providerKey: bundle.providerKey,
    marketplaceId: run.marketplaceId,
    capability: "MARKET_HISTORY",
    mode: bundle.mode,
    state: "AUTHORIZED",
    completeness: "UNKNOWN",
    checkedAt: now,
    ...(bundle.mode === "MOCK"
      ? { dataRights: syntheticFixtureDataRights(now) }
      : {}),
  });
  const retentionDays = capabilityState.dataRights?.retentionDays;
  if (!retentionDays) {
    for (const item of run.items)
      await completeHistoryRefreshItem({
        organizationId: run.organizationId,
        itemId: item.id,
        status: "UNAVAILABLE",
        errorCode: "DATA_RIGHTS_NOT_CONFIGURED",
      });
    await upsertProviderEntitlement({
      organizationId: run.organizationId,
      providerKey: bundle.providerKey,
      marketplaceId: run.marketplaceId,
      capability: "MARKET_HISTORY",
      mode: bundle.mode,
      state: "CONFIGURED",
      reason: "DATA_RIGHTS_NOT_CONFIGURED",
      completeness: "UNKNOWN",
      checkedAt: new Date(),
    });
    await completeHistoryRefreshRun({
      runId: run.id,
      errorCode: "DATA_RIGHTS_NOT_CONFIGURED",
    });
    return;
  }
  const contractualRetainUntil = new Date(
    now.getTime() + retentionDays * 24 * 60 * 60_000,
  );
  if (contractualRetainUntil < retainUntil)
    retainUntil = contractualRetainUntil;
  const cacheKey = {
    organizationId: run.organizationId,
    providerKey: bundle.providerKey,
    marketplaceId: run.marketplaceId,
    capability: "MARKET_HISTORY" as const,
    operation: "getProductHistory",
    requestHash,
  };
  const cache = await getProviderCacheEntry(cacheKey);
  let history;
  let rawEvidenceReference = cache.rawEvidenceReference;
  if (cache.outcome === "FRESH_HIT" && cache.normalizedProjection) {
    history = marketHistoryBatchSchema.parse(cache.normalizedProjection);
    await recordProviderRequestTelemetry({
      ...cacheKey,
      mode: bundle.mode,
      state: "HEALTHY",
      attempt: run.attemptCount,
      startedAt: now,
      completedAt: new Date(),
      cacheOutcome: "FRESH_HIT",
    });
  } else {
    const ownerTokenHash = hash(`${run.id}:${randomUUID()}`);
    const lease = await claimProviderRequestLease({
      ...cacheKey,
      ownerTokenHash,
      leaseExpiresAt: new Date(Date.now() + 5 * 60_000),
    });
    if (!lease.claimed) {
      for (const item of run.items)
        await completeHistoryRefreshItem({
          organizationId: run.organizationId,
          itemId: item.id,
          status: "FAILED_RETRYABLE",
          errorCode: "HISTORY_REQUEST_IN_PROGRESS",
        });
      await completeHistoryRefreshRun({
        runId: run.id,
        retryAt: new Date(Date.now() + 5_000),
        errorCode: "HISTORY_REQUEST_IN_PROGRESS",
      });
      return;
    }
    let budgetReservationId: string | undefined;
    let budgetCost:
      | {
          unit: "TOKEN";
          estimatedUnits: string;
          estimatedMoney?: string;
          currency?: string;
        }
      | undefined;
    try {
      if (bundle.mode === "LIVE") {
        const estimatedUnits = keepaHistoryTokenEstimate(asins.length);
        const budget = estimatedUnits
          ? await findActiveProviderRateBudget({
              organizationId: run.organizationId,
              providerKey: bundle.providerKey,
              marketplaceId: run.marketplaceId,
              capability: "MARKET_HISTORY",
              unit: "TOKEN",
              now,
            })
          : null;
        if (!budget || !estimatedUnits) {
          for (const item of run.items)
            await completeHistoryRefreshItem({
              organizationId: run.organizationId,
              itemId: item.id,
              status: "UNAVAILABLE",
              errorCode: "RATE_BUDGET_NOT_CONFIGURED",
            });
          await upsertProviderEntitlement({
            organizationId: run.organizationId,
            providerKey: bundle.providerKey,
            marketplaceId: run.marketplaceId,
            capability: "MARKET_HISTORY",
            mode: bundle.mode,
            state: "CONFIGURED",
            reason: "RATE_BUDGET_NOT_CONFIGURED",
            completeness: "UNKNOWN",
            checkedAt: new Date(),
          });
          await completeHistoryRefreshRun({
            runId: run.id,
            errorCode: "RATE_BUDGET_NOT_CONFIGURED",
          });
          return;
        }
        const reservation = await reserveProviderBudget({
          organizationId: run.organizationId,
          budgetId: budget.id,
          requestKey: `${requestHash}:${run.attemptCount}`,
          units: estimatedUnits,
          expiresAt: new Date(Date.now() + 5 * 60_000),
          now,
        });
        if (reservation.state !== "RESERVED") {
          const retryAt =
            reservation.state === "QUOTA_EXHAUSTED"
              ? reservation.retryAt
              : undefined;
          for (const item of run.items)
            await completeHistoryRefreshItem({
              organizationId: run.organizationId,
              itemId: item.id,
              status:
                reservation.state === "QUOTA_EXHAUSTED"
                  ? "THROTTLED"
                  : "UNAVAILABLE",
              errorCode: reservation.reason,
            });
          await upsertProviderEntitlement({
            organizationId: run.organizationId,
            providerKey: bundle.providerKey,
            marketplaceId: run.marketplaceId,
            capability: "MARKET_HISTORY",
            mode: bundle.mode,
            state:
              reservation.state === "QUOTA_EXHAUSTED"
                ? "QUOTA_EXHAUSTED"
                : "CONFIGURED",
            reason: reservation.reason,
            completeness: "UNKNOWN",
            checkedAt: new Date(),
            ...(retryAt ? { retryAt } : {}),
          });
          await completeHistoryRefreshRun({
            runId: run.id,
            ...(retryAt ? { retryAt } : {}),
            errorCode: reservation.reason,
          });
          return;
        }
        budgetReservationId = reservation.reservationId;
        budgetCost = {
          unit: "TOKEN",
          estimatedUnits,
          ...(budget.estimatedUnitCost
            ? { estimatedMoney: budget.estimatedUnitCost.toFixed(8) }
            : {}),
          ...(budget.costCurrency ? { currency: budget.costCurrency } : {}),
        };
        await recordProviderRequestTelemetry({
          ...cacheKey,
          entitlementId: budget.entitlementId,
          mode: bundle.mode,
          state: "AUTHORIZED",
          attempt: run.attemptCount,
          startedAt: now,
          cost: budgetCost,
        });
      }
      history = await bundle.provider.getProductHistory?.(
        { asins, historyDays: run.historyDays, includeRatingAndReviews: true },
        marketplace,
      );
      if (!history) throw new ProviderError("PERMANENT");
      const parsed = marketHistoryBatchSchema.parse(history);
      history = parsed;
      if (parsed.rawProviderObservation !== undefined) {
        rawEvidenceReference = `provider-evidence/${run.organizationId}/history/${run.id}/batch.json`;
        await putPrivateObject({
          objectKey: rawEvidenceReference,
          body: new TextEncoder().encode(
            JSON.stringify(sanitiseEvidence(parsed.rawProviderObservation)),
          ),
          contentType: "application/json",
          contentDisposition: "attachment; filename=provider-evidence.json",
        });
      }
      await putProviderCacheEntry({
        ...cacheKey,
        normalizedProjection: JSON.parse(JSON.stringify(parsed)),
        ...(rawEvidenceReference ? { rawEvidenceReference } : {}),
        observedAt: new Date(parsed.provenance.observedAt),
        freshUntil,
        staleUntil,
        retainUntil,
        completeness:
          parsed.value.products.length === asins.length
            ? "COMPLETE"
            : "PARTIAL",
      });
      await recordProviderRequestTelemetry({
        ...cacheKey,
        mode: bundle.mode,
        state:
          parsed.value.products.length === asins.length ? "HEALTHY" : "PARTIAL",
        attempt: run.attemptCount,
        startedAt: now,
        completedAt: new Date(),
        cacheOutcome: "MISS",
        ...(budgetCost ? { cost: budgetCost } : {}),
      });
      await completeProviderRequestLease({ ...cacheKey, ownerTokenHash });
      if (budgetReservationId)
        await settleProviderBudgetReservation({
          organizationId: run.organizationId,
          reservationId: budgetReservationId,
          outcome: "CONSUMED",
        });
    } catch (error) {
      // A response can be lost after the provider accepted the request. Consume
      // the reservation conservatively before a rate-limited retry is queued.
      if (budgetReservationId)
        await settleProviderBudgetReservation({
          organizationId: run.organizationId,
          reservationId: budgetReservationId,
          outcome: "CONSUMED",
        }).catch(() => undefined);
      const detail = providerError(error);
      const retryAt = providerRetryDeadline(
        error instanceof ProviderError ? error.options.retryAfterMs : undefined,
      );
      const status =
        detail.code === "UNAUTHORIZED" || detail.code === "FORBIDDEN"
          ? "UNAUTHORIZED"
          : detail.code === "THROTTLED"
            ? "THROTTLED"
            : detail.status === "RETRYABLE_ERROR"
              ? "FAILED_RETRYABLE"
              : "UNAVAILABLE";
      await recordProviderRequestTelemetry({
        ...cacheKey,
        mode: bundle.mode,
        state:
          detail.code === "THROTTLED"
            ? "THROTTLED"
            : detail.code === "UNAUTHORIZED" || detail.code === "FORBIDDEN"
              ? "UNAUTHORIZED"
              : "UNAVAILABLE",
        attempt: run.attemptCount,
        startedAt: now,
        completedAt: new Date(),
        errorCode: detail.code,
        ...(error instanceof ProviderError && error.options.httpStatus
          ? { httpStatus: error.options.httpStatus }
          : {}),
        ...(retryAt ? { retryAt } : {}),
        ...(budgetCost ? { cost: budgetCost } : {}),
      });
      for (const item of run.items)
        await completeHistoryRefreshItem({
          organizationId: run.organizationId,
          itemId: item.id,
          status,
          errorCode: detail.code,
        });
      await upsertProviderEntitlement({
        organizationId: run.organizationId,
        providerKey: bundle.providerKey,
        marketplaceId: run.marketplaceId,
        capability: "MARKET_HISTORY",
        mode: bundle.mode,
        state:
          detail.code === "THROTTLED"
            ? "THROTTLED"
            : detail.code === "UNAUTHORIZED" || detail.code === "FORBIDDEN"
              ? "UNAUTHORIZED"
              : "UNAVAILABLE",
        reason:
          detail.code === "THROTTLED"
            ? "PROVIDER_THROTTLED"
            : detail.code === "UNAUTHORIZED" || detail.code === "FORBIDDEN"
              ? "CONNECTION_NOT_AUTHORIZED"
              : "PROVIDER_OUTAGE",
        completeness: "UNKNOWN",
        checkedAt: new Date(),
        ...(detail.status === "RETRYABLE_ERROR" || detail.code === "THROTTLED"
          ? { retryAt }
          : {}),
      });
      await completeHistoryRefreshRun({
        runId: run.id,
        retryAt,
        errorCode: detail.code,
      });
      return;
    }
  }
  const products = new Map(
    history.value.products.map((product) => [product.asin, product]),
  );
  await mapWithConcurrency(
    run.items,
    HISTORY_PERSIST_CONCURRENCY,
    async (item) => {
      const product = products.get(item.asin);
      if (!product) {
        await completeHistoryRefreshItem({
          organizationId: run.organizationId,
          itemId: item.id,
          status: "PARTIAL",
          errorCode: "HISTORY_NOT_RETURNED",
        });
        return;
      }
      await persistProduct({
        organizationId: run.organizationId,
        item,
        product,
        requestHash,
        requestInputs,
        providerKey: bundle.providerKey,
        retentionDays,
        observedAt: new Date(history.provenance.observedAt),
        freshUntil,
        ...(rawEvidenceReference ? { rawEvidenceReference } : {}),
      });
      if (item.catalogProductId)
        await calculateHistoryAnalytics({
          organizationId: run.organizationId,
          catalogProductId: item.catalogProductId,
          marketplaceId: run.marketplaceId,
          providerKey: bundle.providerKey,
          calculatedAt: new Date(history.provenance.observedAt),
        });
    },
  );
  await completeHistoryRefreshRun({ runId: run.id });
}
