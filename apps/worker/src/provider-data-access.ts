import { createHash, randomUUID } from "node:crypto";
import { Decimal } from "decimal.js";
import {
  appendProviderRequestTelemetry,
  claimProviderRequestLease,
  completeProviderRequestLease,
  findActiveProviderRateBudget,
  getProviderCacheEntry,
  providerCapabilityAvailability,
  putProviderCacheEntry,
  reserveProviderBudget,
  settleProviderBudgetReservation,
} from "@rizpoint/database";
import {
  ProviderError,
  type ProviderBudgetUnit,
  type ProviderCapability,
  type ProviderCostEstimate,
  type ProviderFreshnessPolicy,
  type ProviderRuntimeMode,
} from "@rizpoint/provider-contracts";
import { resolveProviderFreshnessPolicy } from "@rizpoint/provider-contracts/runtime-policy";

type Completeness = "COMPLETE" | "PARTIAL" | "UNKNOWN";
type CacheOutcome =
  | "MISS"
  | "FRESH_HIT"
  | "STALE_HIT"
  | "EXPIRED"
  | "FORCED_REFRESH"
  | "STALE_REFRESH";

export type ProviderDataResult<T> = {
  projection: T;
  source: "PERSISTED_FRESH" | "PERSISTED_STALE" | "PROVIDER" | "COALESCED";
  cacheOutcome: CacheOutcome;
  providerCalled: boolean;
  observedAt: Date;
  freshUntil: Date;
  staleUntil: Date;
  completeness: Completeness;
  rawEvidenceReference?: string;
  refreshScheduled: boolean;
};

export type ProviderDataFetch<T> = {
  projection: T;
  cacheProjection?: unknown;
  observedAt: Date;
  completeness: Completeness;
  rawEvidenceReference?: string;
};

export type ProviderDataBudget = {
  unit: ProviderBudgetUnit;
  estimatedUnits: string;
  requestKey: string;
  required: boolean;
};

export type ProviderDataRequest<T> = {
  organizationId: string;
  providerKey: string;
  marketplaceId: string;
  capability: ProviderCapability;
  operation: string;
  request: unknown;
  mode: ProviderRuntimeMode;
  entitlementId?: string;
  forceRefresh?: boolean;
  allowStale?: boolean;
  policy?: ProviderFreshnessPolicy;
  retainUntilCap?: Date;
  budget?: ProviderDataBudget;
  now?: Date;
  parse: (projection: unknown) => T;
  fetch: () => Promise<ProviderDataFetch<T>>;
  persistEvidence?: (result: ProviderDataFetch<T>) => Promise<void>;
  scheduleRefresh?: () => Promise<void>;
};

function canonicalize(value: unknown): unknown {
  if (value === undefined) return undefined;
  if (value === null || typeof value === "boolean" || typeof value === "number")
    return value;
  if (typeof value === "string") return value.normalize("NFC");
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === "object")
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, nested]) => nested !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalize(nested)]),
    );
  throw new Error("PROVIDER_REQUEST_IDENTITY_UNSUPPORTED");
}

export function normalizeProviderRequest(value: unknown): unknown {
  return canonicalize(value);
}

export function providerRequestHash(value: unknown): string {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(normalizeProviderRequest(value)))
    .digest("hex")}`;
}

function optionalPositiveInteger(value: string | undefined) {
  if (value === undefined || value === "") return undefined;
  if (!/^\d+$/.test(value) || Number(value) < 1)
    throw new Error("PROVIDER_FRESHNESS_OVERRIDE_INVALID");
  return Number(value);
}

function optionalNonnegativeInteger(value: string | undefined) {
  if (value === undefined || value === "") return undefined;
  if (!/^\d+$/.test(value))
    throw new Error("PROVIDER_FRESHNESS_OVERRIDE_INVALID");
  return Number(value);
}

/** Deployment overrides are explicit per capability and remain server-only. */
export function providerFreshnessPolicy(
  capability: ProviderCapability,
  environment: NodeJS.ProcessEnv = process.env,
) {
  const prefix = `RIZPOINT_CACHE_${capability}`;
  const freshForSeconds = optionalPositiveInteger(
    environment[`${prefix}_FRESH_SECONDS`],
  );
  const staleWhileRevalidateSeconds = optionalNonnegativeInteger(
    environment[`${prefix}_STALE_SECONDS`],
  );
  const retainForSeconds = optionalPositiveInteger(
    environment[`${prefix}_RETAIN_SECONDS`],
  );
  return resolveProviderFreshnessPolicy(capability, {
    ...(freshForSeconds === undefined ? {} : { freshForSeconds }),
    ...(staleWhileRevalidateSeconds === undefined
      ? {}
      : { staleWhileRevalidateSeconds }),
    ...(retainForSeconds === undefined ? {} : { retainForSeconds }),
  });
}

function dates(value: {
  observedAt?: string | undefined;
  freshUntil?: string | undefined;
  staleUntil?: string | undefined;
}) {
  if (!value.observedAt || !value.freshUntil || !value.staleUntil)
    throw new Error("PROVIDER_CACHE_DATES_MISSING");
  return {
    observedAt: new Date(value.observedAt),
    freshUntil: new Date(value.freshUntil),
    staleUntil: new Date(value.staleUntil),
  };
}

function providerErrorTelemetry(error: unknown) {
  if (!(error instanceof ProviderError))
    return {
      state: "UNAVAILABLE" as const,
      errorCode: "UNKNOWN",
      retryAt: undefined,
      httpStatus: undefined,
      providerRequestId: undefined,
    };
  return {
    state:
      error.code === "THROTTLED"
        ? ("THROTTLED" as const)
        : error.code === "UNAUTHORIZED" || error.code === "FORBIDDEN"
          ? ("UNAUTHORIZED" as const)
          : error.code === "INVALID_RESPONSE"
            ? ("PARTIAL" as const)
            : ("UNAVAILABLE" as const),
    errorCode: error.code,
    ...(error.options.httpStatus === undefined
      ? {}
      : { httpStatus: error.options.httpStatus }),
    ...(error.options.providerRequestId
      ? { providerRequestId: error.options.providerRequestId }
      : {}),
    ...(error.options.retryAfterMs === undefined
      ? {}
      : { retryAt: new Date(Date.now() + error.options.retryAfterMs) }),
  };
}

async function telemetry(input: {
  key: ReturnType<typeof cacheKey>;
  entitlementId?: string;
  mode: ProviderRuntimeMode;
  state:
    | "AUTHORIZED"
    | "HEALTHY"
    | "PARTIAL"
    | "THROTTLED"
    | "UNAUTHORIZED"
    | "UNAVAILABLE";
  startedAt: Date;
  completedAt?: Date;
  retryAt?: Date;
  httpStatus?: number;
  errorCode?: string;
  providerRequestId?: string;
  cacheOutcome?: CacheOutcome;
  cost?: ProviderCostEstimate;
}) {
  return appendProviderRequestTelemetry({
    ...input.key,
    ...(input.entitlementId ? { entitlementId: input.entitlementId } : {}),
    mode: input.mode,
    state: input.state,
    startedAt: input.startedAt,
    ...(input.completedAt ? { completedAt: input.completedAt } : {}),
    ...(input.retryAt ? { retryAt: input.retryAt } : {}),
    ...(input.httpStatus === undefined ? {} : { httpStatus: input.httpStatus }),
    ...(input.errorCode ? { errorCode: input.errorCode } : {}),
    ...(input.providerRequestId
      ? { providerRequestId: input.providerRequestId }
      : {}),
    ...(input.cacheOutcome ? { cacheOutcome: input.cacheOutcome } : {}),
    ...(input.cost ? { cost: input.cost } : {}),
  });
}

function cacheKey(input: {
  organizationId: string;
  providerKey: string;
  marketplaceId: string;
  capability: ProviderCapability;
  operation: string;
  request: unknown;
}) {
  return {
    organizationId: input.organizationId,
    providerKey: input.providerKey,
    marketplaceId: input.marketplaceId,
    capability: input.capability,
    operation: input.operation,
    requestHash: providerRequestHash(input.request),
  };
}

export async function providerDataCacheState(input: {
  organizationId: string;
  providerKey: string;
  marketplaceId: string;
  capability: ProviderCapability;
  operation: string;
  request: unknown;
  now?: Date;
}) {
  return getProviderCacheEntry({
    ...cacheKey(input),
    ...(input.now ? { now: input.now } : {}),
  });
}

async function waitForCoalesced<T>(input: {
  key: ReturnType<typeof cacheKey>;
  parse: (projection: unknown) => T;
  now: Date;
  previousObservedAt?: string;
  previousUpdatedAt?: string;
}) {
  const deadline = Date.now() + 5_000;
  do {
    await new Promise((resolve) => setTimeout(resolve, 40));
    const cached = await getProviderCacheEntry({
      ...input.key,
      now: input.now,
    });
    if (
      cached.normalizedProjection !== undefined &&
      cached.observedAt &&
      (cached.observedAt !== input.previousObservedAt ||
        cached.updatedAt !== input.previousUpdatedAt) &&
      cached.outcome !== "EXPIRED"
    )
      return { cached, projection: input.parse(cached.normalizedProjection) };
  } while (Date.now() < deadline);
  throw new ProviderError("TRANSIENT", { retryAfterMs: 1_000 });
}

/**
 * The only worker-side read-through path for provider research data. Web pages
 * never import this module: they read the observations/cache projections that
 * explicit resumable jobs persisted.
 */
export async function accessProviderData<T>(
  input: ProviderDataRequest<T>,
): Promise<ProviderDataResult<T>> {
  const startedAt = input.now ?? new Date();
  const key = cacheKey(input);
  const policy = input.policy ?? providerFreshnessPolicy(input.capability);
  const cached = await getProviderCacheEntry({ ...key, now: startedAt });
  let cachedProjection: T | undefined;
  let effectiveCacheOutcome = cached.outcome;
  if (
    cached.normalizedProjection !== undefined &&
    ["FRESH_HIT", "STALE_HIT"].includes(cached.outcome)
  ) {
    try {
      cachedProjection = input.parse(cached.normalizedProjection);
    } catch {
      // A previously valid provider projection can become unreadable after a
      // contract/schema upgrade. Preserve it for retention/audit, but refresh
      // instead of failing the whole workflow or presenting it as current.
      effectiveCacheOutcome = "EXPIRED";
    }
  }
  if (
    !input.forceRefresh &&
    effectiveCacheOutcome === "FRESH_HIT" &&
    cachedProjection
  ) {
    const cacheDates = dates(cached);
    await telemetry({
      key,
      ...(input.entitlementId ? { entitlementId: input.entitlementId } : {}),
      mode: input.mode,
      state: cached.completeness === "PARTIAL" ? "PARTIAL" : "HEALTHY",
      startedAt,
      completedAt: new Date(),
      cacheOutcome: "FRESH_HIT",
    });
    return {
      projection: cachedProjection,
      source: "PERSISTED_FRESH",
      cacheOutcome: "FRESH_HIT",
      providerCalled: false,
      ...cacheDates,
      completeness: cached.completeness ?? "UNKNOWN",
      ...(cached.rawEvidenceReference
        ? { rawEvidenceReference: cached.rawEvidenceReference }
        : {}),
      refreshScheduled: false,
    };
  }
  if (
    !input.forceRefresh &&
    input.allowStale &&
    effectiveCacheOutcome === "STALE_HIT" &&
    cachedProjection
  ) {
    const cacheDates = dates(cached);
    await input.scheduleRefresh?.();
    await telemetry({
      key,
      ...(input.entitlementId ? { entitlementId: input.entitlementId } : {}),
      mode: input.mode,
      state: "PARTIAL",
      startedAt,
      completedAt: new Date(),
      cacheOutcome: "STALE_HIT",
    });
    return {
      projection: cachedProjection,
      source: "PERSISTED_STALE",
      cacheOutcome: "STALE_HIT",
      providerCalled: false,
      ...cacheDates,
      completeness: cached.completeness ?? "UNKNOWN",
      ...(cached.rawEvidenceReference
        ? { rawEvidenceReference: cached.rawEvidenceReference }
        : {}),
      refreshScheduled: Boolean(input.scheduleRefresh),
    };
  }

  const capability = await providerCapabilityAvailability({
    organizationId: input.organizationId,
    providerKey: input.providerKey,
    marketplaceId: input.marketplaceId,
    capability: input.capability,
    now: startedAt,
  });
  if (!["AUTHORIZED", "HEALTHY", "PARTIAL"].includes(capability.state)) {
    const code =
      capability.state === "THROTTLED" || capability.state === "QUOTA_EXHAUSTED"
        ? "THROTTLED"
        : capability.state === "UNAUTHORIZED"
          ? "UNAUTHORIZED"
          : "PERMANENT";
    throw new ProviderError(code, {
      ...(capability.retryAt
        ? {
            retryAfterMs: Math.max(
              0,
              new Date(capability.retryAt).getTime() - startedAt.getTime(),
            ),
          }
        : {}),
    });
  }

  const ownerTokenHash = providerRequestHash({ owner: randomUUID() });
  const lease = await claimProviderRequestLease({
    ...key,
    ownerTokenHash,
    leaseExpiresAt: new Date(startedAt.getTime() + 5 * 60_000),
    now: startedAt,
  });
  if (!lease.claimed) {
    const coalesced = await waitForCoalesced({
      key,
      parse: input.parse,
      now: startedAt,
      ...(cached.observedAt ? { previousObservedAt: cached.observedAt } : {}),
      ...(cached.updatedAt ? { previousUpdatedAt: cached.updatedAt } : {}),
    });
    const cacheDates = dates(coalesced.cached);
    await telemetry({
      key,
      ...(input.entitlementId ? { entitlementId: input.entitlementId } : {}),
      mode: input.mode,
      state:
        coalesced.cached.completeness === "PARTIAL" ? "PARTIAL" : "HEALTHY",
      startedAt,
      completedAt: new Date(),
      cacheOutcome: "FRESH_HIT",
    });
    return {
      projection: coalesced.projection,
      source: "COALESCED",
      cacheOutcome: "FRESH_HIT",
      providerCalled: false,
      ...cacheDates,
      completeness: coalesced.cached.completeness ?? "UNKNOWN",
      ...(coalesced.cached.rawEvidenceReference
        ? { rawEvidenceReference: coalesced.cached.rawEvidenceReference }
        : {}),
      refreshScheduled: false,
    };
  }

  let reservationId: string | undefined;
  let cost: ProviderCostEstimate | undefined;
  const liveOutcome: CacheOutcome = input.forceRefresh
    ? "FORCED_REFRESH"
    : effectiveCacheOutcome === "STALE_HIT"
      ? "STALE_REFRESH"
      : effectiveCacheOutcome;
  try {
    if (input.budget && input.mode === "LIVE") {
      const budget = await findActiveProviderRateBudget({
        organizationId: input.organizationId,
        providerKey: input.providerKey,
        marketplaceId: input.marketplaceId,
        capability: input.capability,
        unit: input.budget.unit,
        now: startedAt,
      });
      if (!budget) {
        if (input.budget.required) throw new ProviderError("PERMANENT");
      } else {
        const reservation = await reserveProviderBudget({
          organizationId: input.organizationId,
          budgetId: budget.id,
          requestKey: input.budget.requestKey,
          units: input.budget.estimatedUnits,
          expiresAt: new Date(startedAt.getTime() + 5 * 60_000),
          now: startedAt,
        });
        if (reservation.state !== "RESERVED")
          throw new ProviderError(
            reservation.state === "QUOTA_EXHAUSTED" ? "THROTTLED" : "PERMANENT",
            reservation.state === "QUOTA_EXHAUSTED" && reservation.retryAt
              ? {
                  retryAfterMs: Math.max(
                    0,
                    reservation.retryAt.getTime() - startedAt.getTime(),
                  ),
                }
              : {},
          );
        reservationId = reservation.reservationId;
        cost = {
          unit: input.budget.unit,
          estimatedUnits: input.budget.estimatedUnits,
          ...(budget.estimatedUnitCost
            ? {
                estimatedMoney: new Decimal(budget.estimatedUnitCost.toString())
                  .times(input.budget.estimatedUnits)
                  .toFixed(8),
              }
            : {}),
          ...(budget.costCurrency ? { currency: budget.costCurrency } : {}),
        };
      }
    }
    const fetched = await input.fetch();
    if (Number.isNaN(fetched.observedAt.getTime()))
      throw new ProviderError("INVALID_RESPONSE");
    await input.persistEvidence?.(fetched);
    const freshUntil = new Date(
      fetched.observedAt.getTime() + policy.freshForSeconds * 1_000,
    );
    const staleUntil = new Date(
      freshUntil.getTime() + policy.staleWhileRevalidateSeconds * 1_000,
    );
    let retainUntil = new Date(
      fetched.observedAt.getTime() + policy.retainForSeconds * 1_000,
    );
    if (input.retainUntilCap && input.retainUntilCap < retainUntil)
      retainUntil = input.retainUntilCap;
    if (retainUntil < staleUntil)
      throw new Error("PROVIDER_RIGHTS_SHORTER_THAN_STALE_WINDOW");
    await putProviderCacheEntry({
      ...key,
      ...(input.entitlementId ? { entitlementId: input.entitlementId } : {}),
      normalizedProjection: JSON.parse(
        JSON.stringify(fetched.cacheProjection ?? fetched.projection),
      ),
      ...(fetched.rawEvidenceReference
        ? { rawEvidenceReference: fetched.rawEvidenceReference }
        : {}),
      observedAt: fetched.observedAt,
      freshUntil,
      staleUntil,
      retainUntil,
      completeness: fetched.completeness,
    });
    await completeProviderRequestLease({ ...key, ownerTokenHash });
    if (reservationId)
      await settleProviderBudgetReservation({
        organizationId: input.organizationId,
        reservationId,
        outcome: "CONSUMED",
      });
    await telemetry({
      key,
      ...(input.entitlementId ? { entitlementId: input.entitlementId } : {}),
      mode: input.mode,
      state: fetched.completeness === "COMPLETE" ? "HEALTHY" : "PARTIAL",
      startedAt,
      completedAt: new Date(),
      cacheOutcome: liveOutcome,
      ...(cost ? { cost } : {}),
    });
    return {
      projection: fetched.projection,
      source: "PROVIDER",
      cacheOutcome: liveOutcome,
      providerCalled: true,
      observedAt: fetched.observedAt,
      freshUntil,
      staleUntil,
      completeness: fetched.completeness,
      ...(fetched.rawEvidenceReference
        ? { rawEvidenceReference: fetched.rawEvidenceReference }
        : {}),
      refreshScheduled: false,
    };
  } catch (error) {
    if (reservationId)
      await settleProviderBudgetReservation({
        organizationId: input.organizationId,
        reservationId,
        outcome: "CONSUMED",
      }).catch(() => undefined);
    const detail = providerErrorTelemetry(error);
    await telemetry({
      key,
      ...(input.entitlementId ? { entitlementId: input.entitlementId } : {}),
      mode: input.mode,
      state: detail.state,
      startedAt,
      completedAt: new Date(),
      cacheOutcome: liveOutcome,
      ...(detail.retryAt ? { retryAt: detail.retryAt } : {}),
      ...(detail.httpStatus === undefined
        ? {}
        : { httpStatus: detail.httpStatus }),
      errorCode: detail.errorCode,
      ...(detail.providerRequestId
        ? { providerRequestId: detail.providerRequestId }
        : {}),
      ...(cost ? { cost } : {}),
    }).catch(() => undefined);
    throw error;
  }
}
