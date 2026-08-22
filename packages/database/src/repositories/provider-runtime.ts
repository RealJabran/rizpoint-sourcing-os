import { randomUUID } from "node:crypto";
import type {
  ProviderCacheLookup,
  ProviderCapability,
  ProviderCapabilityState,
  ProviderCostEstimate,
  ProviderDataRights,
  ProviderOperationalState,
  ProviderRuntimeMode,
  ProviderUnavailableReason,
} from "@rizpoint/provider-contracts";
import { Prisma } from "../generated/prisma/client.js";
import { db } from "../client.js";

const decimalPattern = /^\d+(?:\.\d+)?$/;

async function serializableTransaction<T>(
  operation: (transaction: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await db.$transaction(operation, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      const code =
        error && typeof error === "object" && "code" in error
          ? String(error.code)
          : undefined;
      if (code !== "P2034" || attempt === 3) throw error;
    }
  }
  throw new Error("SERIALIZABLE_TRANSACTION_RETRY_EXHAUSTED");
}

function positiveDecimal(value: string, field: string): string {
  if (!decimalPattern.test(value) || new Prisma.Decimal(value).lte(0))
    throw new Error(`${field}_INVALID`);
  return value;
}

function nonnegativeDecimal(value: string, field: string): string {
  if (!decimalPattern.test(value) || new Prisma.Decimal(value).lt(0))
    throw new Error(`${field}_INVALID`);
  return value;
}

function reasonFromCode(
  reasonCode: string | null,
): ProviderUnavailableReason | undefined {
  const allowed = new Set<ProviderUnavailableReason>([
    "CREDENTIALS_MISSING",
    "CONNECTION_NOT_AUTHORIZED",
    "CAPABILITY_NOT_ENTITLED",
    "QUOTA_WINDOW_EXHAUSTED",
    "PROVIDER_THROTTLED",
    "PROVIDER_OUTAGE",
    "PARTIAL_RESPONSE",
    "STALE_CACHE_ONLY",
    "UNSUPPORTED_BY_PROVIDER",
    "DATA_NOT_RETURNED",
    "RATE_BUDGET_NOT_CONFIGURED",
    "DATA_RIGHTS_NOT_CONFIGURED",
    "REQUEST_ALREADY_SETTLED",
  ]);
  return reasonCode && allowed.has(reasonCode as ProviderUnavailableReason)
    ? (reasonCode as ProviderUnavailableReason)
    : undefined;
}

function capabilityStateDto(input: {
  providerKey: string;
  marketplaceId: string;
  capability: ProviderCapability;
  mode: ProviderRuntimeMode;
  state: ProviderOperationalState;
  checkedAt: Date;
  expiresAt: Date | null;
  retryAt: Date | null;
  reasonCode: string | null;
  completeness: "COMPLETE" | "PARTIAL" | "UNKNOWN";
  dataUsageScope: "INTERNAL_ONLY" | "REDISTRIBUTABLE";
  exportPolicy: "BLOCK" | "ALLOW" | "FIELD_ALLOWLIST";
  exportableFields: string[];
  dataRetentionDays: number | null;
  termsReference: string | null;
  termsVersion: string | null;
  termsReviewedAt: Date | null;
  rightsEffectiveAt: Date | null;
  rightsExpiresAt: Date | null;
}): ProviderCapabilityState {
  const reason = reasonFromCode(input.reasonCode);
  return {
    providerKey: input.providerKey,
    marketplaceId: input.marketplaceId,
    capability: input.capability,
    mode: input.mode,
    state: input.state,
    checkedAt: input.checkedAt.toISOString(),
    ...(input.expiresAt ? { expiresAt: input.expiresAt.toISOString() } : {}),
    ...(input.retryAt ? { retryAt: input.retryAt.toISOString() } : {}),
    ...(reason ? { reason } : {}),
    completeness: input.completeness,
    dataRights: {
      usageScope: input.dataUsageScope,
      exportPolicy: input.exportPolicy,
      exportableFields: input.exportableFields,
      ...(input.dataRetentionDays
        ? { retentionDays: input.dataRetentionDays }
        : {}),
      ...(input.termsReference ? { termsReference: input.termsReference } : {}),
      ...(input.termsVersion ? { termsVersion: input.termsVersion } : {}),
      ...(input.termsReviewedAt
        ? { termsReviewedAt: input.termsReviewedAt.toISOString() }
        : {}),
      ...(input.rightsEffectiveAt
        ? { effectiveAt: input.rightsEffectiveAt.toISOString() }
        : {}),
      ...(input.rightsExpiresAt
        ? { expiresAt: input.rightsExpiresAt.toISOString() }
        : {}),
    },
  };
}

export type ProviderDataRightsInput = Omit<
  ProviderDataRights,
  "termsReviewedAt" | "effectiveAt" | "expiresAt"
> & {
  termsReviewedAt: Date;
  effectiveAt: Date;
  expiresAt?: Date;
};

function providerDataRightsData(input: ProviderDataRightsInput) {
  if (
    input.retentionDays !== undefined &&
    (input.retentionDays < 1 || input.retentionDays > 3650)
  )
    throw new Error("PROVIDER_RETENTION_DAYS_INVALID");
  if (
    input.exportPolicy !== "BLOCK" &&
    (input.usageScope !== "REDISTRIBUTABLE" ||
      !input.retentionDays ||
      !input.termsReference?.trim() ||
      !input.termsVersion?.trim())
  )
    throw new Error("PROVIDER_EXPORT_RIGHTS_INCOMPLETE");
  if (
    input.exportPolicy === "FIELD_ALLOWLIST" &&
    input.exportableFields.length === 0
  )
    throw new Error("PROVIDER_EXPORT_ALLOWLIST_REQUIRED");
  if (input.expiresAt && input.expiresAt <= input.effectiveAt)
    throw new Error("PROVIDER_RIGHTS_WINDOW_INVALID");
  return {
    dataUsageScope: input.usageScope,
    exportPolicy: input.exportPolicy,
    exportableFields: [...new Set(input.exportableFields)].sort(),
    dataRetentionDays: input.retentionDays ?? null,
    termsReference: input.termsReference ?? null,
    termsVersion: input.termsVersion ?? null,
    termsReviewedAt: input.termsReviewedAt,
    rightsEffectiveAt: input.effectiveAt,
    rightsExpiresAt: input.expiresAt ?? null,
  };
}

export async function updateProviderDataRights(input: {
  organizationId: string;
  providerKey: string;
  marketplaceId: string;
  capability: ProviderCapability;
  dataRights: ProviderDataRightsInput;
}) {
  const data = providerDataRightsData(input.dataRights);
  return db.$transaction(async (transaction) => {
    const entitlement = await transaction.providerEntitlement.findFirst({
      where: {
        organizationId: input.organizationId,
        providerKey: input.providerKey,
        marketplaceId: input.marketplaceId,
        capability: input.capability,
      },
      select: { id: true },
    });
    if (!entitlement) throw new Error("PROVIDER_ENTITLEMENT_NOT_FOUND");
    const updated = await transaction.providerEntitlement.update({
      where: { id: entitlement.id },
      data,
    });
    let shortenedSeriesCount = 0;
    let shortenedCacheCount = 0;
    if (data.dataRetentionDays) {
      shortenedSeriesCount = (
        await transaction.historicalMetricSeries.updateMany({
          where: {
            organizationId: input.organizationId,
            marketplaceId: input.marketplaceId,
            providerKey: input.providerKey,
            retentionDays: { gt: data.dataRetentionDays },
          },
          data: { retentionDays: data.dataRetentionDays },
        })
      ).count;
      shortenedCacheCount = await transaction.$executeRaw(Prisma.sql`
        UPDATE provider_cache_entries
        SET retain_until = LEAST(
              retain_until,
              observed_at + (${data.dataRetentionDays} * INTERVAL '1 day')
            ),
            updated_at = CURRENT_TIMESTAMP
        WHERE organization_id = ${input.organizationId}
          AND entitlement_id = ${entitlement.id}
          AND retain_until > observed_at + (${data.dataRetentionDays} * INTERVAL '1 day')
      `);
    }
    await transaction.workflowAuditEvent.create({
      data: {
        organizationId: input.organizationId,
        entityType: "PROVIDER_ENTITLEMENT",
        entityId: entitlement.id,
        eventType: "DATA_RIGHTS_UPDATED",
        payload: {
          providerKey: input.providerKey,
          marketplaceId: input.marketplaceId,
          capability: input.capability,
          usageScope: input.dataRights.usageScope,
          exportPolicy: input.dataRights.exportPolicy,
          exportableFields: data.exportableFields,
          retentionDays: input.dataRights.retentionDays ?? null,
          termsReference: input.dataRights.termsReference ?? null,
          termsVersion: input.dataRights.termsVersion ?? null,
          termsReviewedAt: input.dataRights.termsReviewedAt.toISOString(),
          effectiveAt: input.dataRights.effectiveAt.toISOString(),
          expiresAt: input.dataRights.expiresAt?.toISOString() ?? null,
          shortenedSeriesCount,
          shortenedCacheCount,
        },
      },
    });
    return capabilityStateDto(updated);
  });
}

export type EncryptedProviderCredentialInput = {
  organizationId: string;
  providerKey: string;
  credentialName: string;
  ciphertext: string;
  encryptionNonce: string;
  encryptionTag: string;
  encryptionKeyVersion: number;
};

/** Stores only an already-encrypted envelope. Plaintext secret material is not
 * accepted by this repository or returned by any status query. */
export async function storeEncryptedProviderCredential(
  input: EncryptedProviderCredentialInput,
) {
  if (input.encryptionKeyVersion < 1)
    throw new Error("CREDENTIAL_KEY_VERSION_INVALID");
  return db.providerCredential.upsert({
    where: {
      organizationId_providerKey_credentialName: {
        organizationId: input.organizationId,
        providerKey: input.providerKey,
        credentialName: input.credentialName,
      },
    },
    create: input,
    update: {
      ciphertext: input.ciphertext,
      encryptionNonce: input.encryptionNonce,
      encryptionTag: input.encryptionTag,
      encryptionKeyVersion: input.encryptionKeyVersion,
      rotatedAt: new Date(),
      revokedAt: null,
    },
    select: {
      id: true,
      organizationId: true,
      providerKey: true,
      credentialName: true,
      encryptionKeyVersion: true,
      rotatedAt: true,
      revokedAt: true,
    },
  });
}

/** Worker-only retrieval of an encrypted envelope. Callers must decrypt it
 * locally with the server vault and must never serialize this result. */
export async function getEncryptedProviderCredentialForWorker(input: {
  organizationId: string;
  providerKey: string;
  credentialName: string;
}) {
  return db.providerCredential.findFirst({
    where: {
      organizationId: input.organizationId,
      providerKey: input.providerKey,
      credentialName: input.credentialName,
      revokedAt: null,
    },
    select: {
      ciphertext: true,
      encryptionNonce: true,
      encryptionTag: true,
      encryptionKeyVersion: true,
    },
  });
}

/** Safe configuration probe for status endpoints; intentionally excludes all
 * envelope fields. */
export async function hasActiveProviderCredential(input: {
  organizationId: string;
  providerKey: string;
  credentialName: string;
}): Promise<boolean> {
  const credential = await db.providerCredential.findFirst({
    where: {
      organizationId: input.organizationId,
      providerKey: input.providerKey,
      credentialName: input.credentialName,
      revokedAt: null,
    },
    select: { id: true },
  });
  return credential !== null;
}

export async function upsertProviderEntitlement(input: {
  organizationId: string;
  providerConnectionId?: string;
  providerKey: string;
  marketplaceId: string;
  capability: ProviderCapability;
  mode: ProviderRuntimeMode;
  state: ProviderOperationalState;
  reason?: ProviderUnavailableReason;
  completeness: "COMPLETE" | "PARTIAL" | "UNKNOWN";
  checkedAt: Date;
  expiresAt?: Date;
  retryAt?: Date;
  dataRights?: ProviderDataRightsInput;
}) {
  if (input.providerConnectionId) {
    const connection = await db.providerConnection.findFirst({
      where: {
        id: input.providerConnectionId,
        organizationId: input.organizationId,
      },
      select: { id: true },
    });
    if (!connection) throw new Error("PROVIDER_CONNECTION_NOT_FOUND");
  }
  const dataRights = input.dataRights
    ? providerDataRightsData(input.dataRights)
    : undefined;
  const entitlement = await db.providerEntitlement.upsert({
    where: {
      organizationId_providerKey_marketplaceId_capability: {
        organizationId: input.organizationId,
        providerKey: input.providerKey,
        marketplaceId: input.marketplaceId,
        capability: input.capability,
      },
    },
    create: {
      organizationId: input.organizationId,
      ...(input.providerConnectionId
        ? { providerConnectionId: input.providerConnectionId }
        : {}),
      providerKey: input.providerKey,
      marketplaceId: input.marketplaceId,
      capability: input.capability,
      mode: input.mode,
      state: input.state,
      ...(input.reason ? { reasonCode: input.reason } : {}),
      completeness: input.completeness,
      checkedAt: input.checkedAt,
      ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
      ...(input.retryAt ? { retryAt: input.retryAt } : {}),
      ...(dataRights ?? {}),
      ...(["AUTHORIZED", "HEALTHY"].includes(input.state)
        ? { lastSuccessAt: input.checkedAt }
        : {}),
    },
    update: {
      providerConnectionId: input.providerConnectionId ?? null,
      mode: input.mode,
      state: input.state,
      reasonCode: input.reason ?? null,
      completeness: input.completeness,
      checkedAt: input.checkedAt,
      expiresAt: input.expiresAt ?? null,
      retryAt: input.retryAt ?? null,
      ...(dataRights ?? {}),
      ...(["AUTHORIZED", "HEALTHY"].includes(input.state)
        ? { lastSuccessAt: input.checkedAt }
        : {}),
    },
  });
  return capabilityStateDto(entitlement);
}

/** Public-safe, tenant-scoped capability projection. */
export async function listProviderCapabilityStates(input: {
  organizationId: string;
  providerKey?: string;
  marketplaceId?: string;
}): Promise<ProviderCapabilityState[]> {
  const rows = await db.providerEntitlement.findMany({
    where: {
      organizationId: input.organizationId,
      ...(input.providerKey ? { providerKey: input.providerKey } : {}),
      ...(input.marketplaceId ? { marketplaceId: input.marketplaceId } : {}),
    },
    orderBy: [{ providerKey: "asc" }, { capability: "asc" }],
  });
  return rows.map(capabilityStateDto);
}

export async function createOrUpdateProviderRateBudget(input: {
  organizationId: string;
  entitlementId: string;
  unit: "REQUEST" | "CREDIT" | "TOKEN";
  windowStart: Date;
  windowEnd: Date;
  capacity: string;
  estimatedUnitCost?: string;
  costCurrency?: string;
}) {
  if (input.windowEnd <= input.windowStart)
    throw new Error("BUDGET_WINDOW_INVALID");
  positiveDecimal(input.capacity, "BUDGET_CAPACITY");
  if (input.estimatedUnitCost !== undefined)
    nonnegativeDecimal(input.estimatedUnitCost, "BUDGET_UNIT_COST");
  if (
    input.costCurrency !== undefined &&
    !/^[A-Z]{3}$/.test(input.costCurrency)
  )
    throw new Error("BUDGET_CURRENCY_INVALID");
  const entitlement = await db.providerEntitlement.findFirst({
    where: {
      id: input.entitlementId,
      organizationId: input.organizationId,
    },
    select: { id: true },
  });
  if (!entitlement) throw new Error("PROVIDER_ENTITLEMENT_NOT_FOUND");
  return db.providerRateBudget.upsert({
    where: {
      entitlementId_unit_windowStart_windowEnd: {
        entitlementId: input.entitlementId,
        unit: input.unit,
        windowStart: input.windowStart,
        windowEnd: input.windowEnd,
      },
    },
    create: input,
    update: {
      capacity: input.capacity,
      estimatedUnitCost: input.estimatedUnitCost ?? null,
      costCurrency: input.costCurrency ?? null,
    },
  });
}

/** Returns the active tenant-scoped budget for a capability without exposing
 * credentials or provider payloads. */
export async function findActiveProviderRateBudget(input: {
  organizationId: string;
  providerKey: string;
  marketplaceId: string;
  capability: ProviderCapability;
  unit: "REQUEST" | "CREDIT" | "TOKEN";
  now?: Date;
}) {
  const now = input.now ?? new Date();
  return db.providerRateBudget.findFirst({
    where: {
      organizationId: input.organizationId,
      unit: input.unit,
      windowStart: { lte: now },
      windowEnd: { gt: now },
      entitlement: {
        organizationId: input.organizationId,
        providerKey: input.providerKey,
        marketplaceId: input.marketplaceId,
        capability: input.capability,
      },
    },
    orderBy: { windowEnd: "asc" },
    select: {
      id: true,
      entitlementId: true,
      estimatedUnitCost: true,
      costCurrency: true,
    },
  });
}

export type ProviderBudgetReservationResult =
  | { state: "RESERVED"; reservationId: string; duplicate: boolean }
  | {
      state: "QUOTA_EXHAUSTED";
      retryAt?: Date;
      reason: "QUOTA_WINDOW_EXHAUSTED";
    }
  | {
      state: "NOT_CONFIGURED";
      reason: "RATE_BUDGET_NOT_CONFIGURED";
    }
  | {
      state: "UNAVAILABLE";
      reason: "REQUEST_ALREADY_SETTLED";
    };

/** Serializes one budget row before reserving credits. The reservation unique
 * key makes retries free and the NUMERIC comparison prevents over-allocation. */
export async function reserveProviderBudget(input: {
  organizationId: string;
  budgetId: string;
  requestKey: string;
  units: string;
  expiresAt: Date;
  now?: Date;
}): Promise<ProviderBudgetReservationResult> {
  positiveDecimal(input.units, "BUDGET_UNITS");
  const now = input.now ?? new Date();
  return db.$transaction(async (transaction) => {
    const locked = await transaction.$queryRaw<
      Array<{
        id: string;
        entitlement_id: string;
        window_start: Date;
        window_end: Date;
        available: Prisma.Decimal;
        estimated_unit_cost: Prisma.Decimal | null;
      }>
    >(Prisma.sql`
      SELECT id, entitlement_id, window_start, window_end,
             capacity - reserved - consumed AS available,
             estimated_unit_cost
      FROM provider_rate_budgets
      WHERE id = ${input.budgetId}
        AND organization_id = ${input.organizationId}
      FOR UPDATE
    `);
    const budget = locked[0];
    if (!budget)
      return {
        state: "NOT_CONFIGURED",
        reason: "RATE_BUDGET_NOT_CONFIGURED",
      };

    const expiredReservations =
      await transaction.providerBudgetReservation.findMany({
        where: {
          organizationId: input.organizationId,
          budgetId: input.budgetId,
          status: "RESERVED",
          expiresAt: { lte: now },
        },
        select: { id: true, units: true },
      });
    const expiredUnits = expiredReservations.reduce(
      (total, reservation) => total.plus(reservation.units),
      new Prisma.Decimal(0),
    );
    if (expiredUnits.gt(0)) {
      await transaction.providerBudgetReservation.updateMany({
        where: { id: { in: expiredReservations.map(({ id }) => id) } },
        data: { status: "EXPIRED", releasedAt: now },
      });
      await transaction.providerRateBudget.update({
        where: { id: budget.id },
        data: { reserved: { decrement: expiredUnits } },
      });
    }

    const existing = await transaction.providerBudgetReservation.findUnique({
      where: {
        organizationId_budgetId_requestKey: {
          organizationId: input.organizationId,
          budgetId: input.budgetId,
          requestKey: input.requestKey,
        },
      },
    });
    if (existing) {
      if (existing.status === "RESERVED" || existing.status === "CONSUMED")
        return {
          state: "RESERVED",
          reservationId: existing.id,
          duplicate: true,
        };
      return { state: "UNAVAILABLE", reason: "REQUEST_ALREADY_SETTLED" };
    }

    if (
      budget.window_start > now ||
      budget.window_end <= now ||
      budget.available.plus(expiredUnits).lt(new Prisma.Decimal(input.units))
    ) {
      const retryAt =
        budget.window_start > now ? budget.window_start : budget.window_end;
      await transaction.providerEntitlement.updateMany({
        where: {
          id: budget.entitlement_id,
          organizationId: input.organizationId,
        },
        data: {
          state: "QUOTA_EXHAUSTED",
          reasonCode: "QUOTA_WINDOW_EXHAUSTED",
          retryAt,
          checkedAt: now,
        },
      });
      return {
        state: "QUOTA_EXHAUSTED",
        retryAt,
        reason: "QUOTA_WINDOW_EXHAUSTED",
      };
    }
    const reservation = await transaction.providerBudgetReservation.create({
      data: {
        id: randomUUID(),
        organizationId: input.organizationId,
        budgetId: input.budgetId,
        requestKey: input.requestKey,
        units: input.units,
        ...(budget.estimated_unit_cost
          ? { estimatedCost: budget.estimated_unit_cost.mul(input.units) }
          : {}),
        expiresAt: input.expiresAt,
      },
    });
    await transaction.providerRateBudget.update({
      where: { id: input.budgetId },
      data: { reserved: { increment: input.units } },
    });
    return {
      state: "RESERVED",
      reservationId: reservation.id,
      duplicate: false,
    };
  });
}

export async function settleProviderBudgetReservation(input: {
  organizationId: string;
  reservationId: string;
  outcome: "CONSUMED" | "RELEASED";
  now?: Date;
}) {
  const now = input.now ?? new Date();
  return db.$transaction(async (transaction) => {
    const initial = await transaction.providerBudgetReservation.findFirst({
      where: { id: input.reservationId, organizationId: input.organizationId },
      select: { budgetId: true },
    });
    if (!initial) throw new Error("BUDGET_RESERVATION_NOT_FOUND");
    await transaction.$queryRaw(Prisma.sql`
      SELECT id
      FROM provider_rate_budgets
      WHERE id = ${initial.budgetId}
        AND organization_id = ${input.organizationId}
      FOR UPDATE
    `);
    await transaction.$queryRaw(Prisma.sql`
      SELECT id
      FROM provider_budget_reservations
      WHERE id = ${input.reservationId}
        AND organization_id = ${input.organizationId}
      FOR UPDATE
    `);
    const reservation = await transaction.providerBudgetReservation.findFirst({
      where: { id: input.reservationId, organizationId: input.organizationId },
    });
    if (!reservation) throw new Error("BUDGET_RESERVATION_NOT_FOUND");
    if (reservation.status === input.outcome)
      return { reservation, duplicate: true };
    if (reservation.status !== "RESERVED")
      throw new Error("BUDGET_RESERVATION_ALREADY_SETTLED");
    await transaction.providerRateBudget.update({
      where: { id: reservation.budgetId },
      data: {
        reserved: { decrement: reservation.units },
        ...(input.outcome === "CONSUMED"
          ? { consumed: { increment: reservation.units } }
          : {}),
      },
    });
    const updated = await transaction.providerBudgetReservation.update({
      where: { id: reservation.id },
      data: {
        status: input.outcome,
        ...(input.outcome === "CONSUMED"
          ? { consumedAt: now }
          : { releasedAt: now }),
      },
    });
    return { reservation: updated, duplicate: false };
  });
}

type CacheKey = {
  organizationId: string;
  providerKey: string;
  marketplaceId: string;
  capability: ProviderCapability;
  operation: string;
  requestHash: string;
};

export async function getProviderCacheEntry(
  input: CacheKey & { now?: Date },
): Promise<
  ProviderCacheLookup & {
    normalizedProjection?: Prisma.JsonValue;
    rawEvidenceReference?: string;
    updatedAt?: string;
  }
> {
  const row = await db.providerCacheEntry.findUnique({
    where: {
      organizationId_providerKey_marketplaceId_capability_operation_requestHash:
        {
          organizationId: input.organizationId,
          providerKey: input.providerKey,
          marketplaceId: input.marketplaceId,
          capability: input.capability,
          operation: input.operation,
          requestHash: input.requestHash,
        },
    },
  });
  if (!row) return { outcome: "MISS" };
  const now = input.now ?? new Date();
  const outcome =
    row.freshUntil > now
      ? "FRESH_HIT"
      : row.staleUntil > now
        ? "STALE_HIT"
        : "EXPIRED";
  return {
    outcome,
    observedAt: row.observedAt.toISOString(),
    freshUntil: row.freshUntil.toISOString(),
    staleUntil: row.staleUntil.toISOString(),
    completeness: row.completeness,
    updatedAt: row.updatedAt.toISOString(),
    ...(row.normalizedProjection === null
      ? {}
      : { normalizedProjection: row.normalizedProjection }),
    ...(row.rawEvidenceReference
      ? { rawEvidenceReference: row.rawEvidenceReference }
      : {}),
  };
}

/** Raw evidence has a shorter provider-cache retention than its normalized
 * series. The caller deletes the private object before clearing this reference. */
export async function listExpiredProviderEvidence(
  now = new Date(),
  limit = 250,
) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 1_000)
    throw new Error("PROVIDER_RETENTION_BATCH_LIMIT_INVALID");
  return db.providerCacheEntry.findMany({
    where: {
      capability: "MARKET_HISTORY",
      retainUntil: { lte: now },
      rawEvidenceReference: { not: null },
    },
    select: { id: true, rawEvidenceReference: true },
    orderBy: { retainUntil: "asc" },
    take: limit,
  });
}

export async function acknowledgeExpiredProviderEvidence(id: string) {
  const entry = await db.providerCacheEntry.findUnique({
    where: { id },
    select: { rawEvidenceReference: true },
  });
  await db.providerCacheEntry.update({
    where: { id },
    data: { rawEvidenceReference: null },
  });
  if (entry?.rawEvidenceReference)
    await db.$transaction([
      db.historyRefreshItem.updateMany({
        where: { rawEvidenceReference: entry.rawEvidenceReference },
        data: { rawEvidenceReference: null },
      }),
      db.researchObservation.updateMany({
        where: { rawEvidenceReference: entry.rawEvidenceReference },
        data: { rawEvidenceReference: null },
      }),
    ]);
}

export async function putProviderCacheEntry(
  input: CacheKey & {
    entitlementId?: string;
    normalizedProjection?: Prisma.InputJsonValue;
    rawEvidenceReference?: string;
    observedAt: Date;
    freshUntil: Date;
    staleUntil: Date;
    retainUntil: Date;
    completeness: "COMPLETE" | "PARTIAL" | "UNKNOWN";
  },
) {
  if (
    input.freshUntil < input.observedAt ||
    input.staleUntil < input.freshUntil ||
    input.retainUntil < input.staleUntil
  )
    throw new Error("CACHE_FRESHNESS_WINDOW_INVALID");
  return serializableTransaction(async (transaction) => {
    const key = {
      organizationId: input.organizationId,
      providerKey: input.providerKey,
      marketplaceId: input.marketplaceId,
      capability: input.capability,
      operation: input.operation,
      requestHash: input.requestHash,
    };
    const existing = await transaction.providerCacheEntry.findUnique({
      where: {
        organizationId_providerKey_marketplaceId_capability_operation_requestHash:
          key,
      },
    });
    if (existing && existing.observedAt > input.observedAt)
      return { entry: existing, replaced: false };
    const entry = await transaction.providerCacheEntry.upsert({
      where: {
        organizationId_providerKey_marketplaceId_capability_operation_requestHash:
          key,
      },
      create: input,
      update: {
        entitlementId: input.entitlementId ?? null,
        ...(input.normalizedProjection === undefined
          ? {}
          : { normalizedProjection: input.normalizedProjection }),
        rawEvidenceReference: input.rawEvidenceReference ?? null,
        observedAt: input.observedAt,
        freshUntil: input.freshUntil,
        staleUntil: input.staleUntil,
        retainUntil: input.retainUntil,
        completeness: input.completeness,
      },
    });
    return { entry, replaced: Boolean(existing) };
  });
}

export async function claimProviderRequestLease(
  input: CacheKey & {
    ownerTokenHash: string;
    leaseExpiresAt: Date;
    now?: Date;
  },
) {
  const now = input.now ?? new Date();
  const key = {
    organizationId: input.organizationId,
    providerKey: input.providerKey,
    marketplaceId: input.marketplaceId,
    capability: input.capability,
    operation: input.operation,
    requestHash: input.requestHash,
  };
  return serializableTransaction(async (transaction) => {
    const existing = await transaction.providerRequestLease.findUnique({
      where: {
        organizationId_providerKey_marketplaceId_capability_operation_requestHash:
          key,
      },
    });
    if (
      existing?.state === "ACTIVE" &&
      existing.leaseExpiresAt > now &&
      existing.ownerTokenHash !== input.ownerTokenHash
    )
      return { claimed: false, duplicate: true, lease: existing };
    const lease = await transaction.providerRequestLease.upsert({
      where: {
        organizationId_providerKey_marketplaceId_capability_operation_requestHash:
          key,
      },
      create: {
        ...key,
        ownerTokenHash: input.ownerTokenHash,
        leaseExpiresAt: input.leaseExpiresAt,
      },
      update: {
        ownerTokenHash: input.ownerTokenHash,
        leaseExpiresAt: input.leaseExpiresAt,
        state: "ACTIVE",
        completedAt: null,
      },
    });
    return { claimed: true, duplicate: Boolean(existing), lease };
  });
}

export async function completeProviderRequestLease(
  input: CacheKey & {
    ownerTokenHash: string;
    now?: Date;
  },
) {
  const result = await db.providerRequestLease.updateMany({
    where: {
      organizationId: input.organizationId,
      providerKey: input.providerKey,
      marketplaceId: input.marketplaceId,
      capability: input.capability,
      operation: input.operation,
      requestHash: input.requestHash,
      ownerTokenHash: input.ownerTokenHash,
      state: "ACTIVE",
    },
    data: { state: "COMPLETED", completedAt: input.now ?? new Date() },
  });
  if (result.count !== 1) throw new Error("PROVIDER_REQUEST_LEASE_NOT_OWNED");
}

export async function recordProviderRequestTelemetry(input: {
  organizationId: string;
  entitlementId?: string;
  providerKey: string;
  marketplaceId: string;
  capability: ProviderCapability;
  operation: string;
  requestHash: string;
  mode: ProviderRuntimeMode;
  state: ProviderOperationalState;
  attempt: number;
  startedAt: Date;
  completedAt?: Date;
  retryAt?: Date;
  httpStatus?: number;
  errorCode?: string;
  providerRequestId?: string;
  cacheOutcome?:
    | "MISS"
    | "FRESH_HIT"
    | "STALE_HIT"
    | "EXPIRED"
    | "FORCED_REFRESH"
    | "STALE_REFRESH";
  cost?: ProviderCostEstimate;
}) {
  if (input.attempt < 1) throw new Error("PROVIDER_ATTEMPT_INVALID");
  return db.providerRequestAttempt.upsert({
    where: {
      organizationId_providerKey_marketplaceId_capability_operation_requestHash_attempt:
        {
          organizationId: input.organizationId,
          providerKey: input.providerKey,
          marketplaceId: input.marketplaceId,
          capability: input.capability,
          operation: input.operation,
          requestHash: input.requestHash,
          attempt: input.attempt,
        },
    },
    create: {
      organizationId: input.organizationId,
      ...(input.entitlementId ? { entitlementId: input.entitlementId } : {}),
      providerKey: input.providerKey,
      marketplaceId: input.marketplaceId,
      capability: input.capability,
      operation: input.operation,
      requestHash: input.requestHash,
      mode: input.mode,
      state: input.state,
      attempt: input.attempt,
      startedAt: input.startedAt,
      ...(input.completedAt ? { completedAt: input.completedAt } : {}),
      ...(input.retryAt ? { retryAt: input.retryAt } : {}),
      ...(input.httpStatus === undefined
        ? {}
        : { httpStatus: input.httpStatus }),
      ...(input.errorCode ? { errorCode: input.errorCode } : {}),
      ...(input.providerRequestId
        ? { providerRequestId: input.providerRequestId }
        : {}),
      ...(input.cacheOutcome ? { cacheOutcome: input.cacheOutcome } : {}),
      ...(input.cost
        ? {
            budgetUnit: input.cost.unit,
            estimatedUnits: input.cost.estimatedUnits,
            ...(input.cost.estimatedMoney
              ? { estimatedCost: input.cost.estimatedMoney }
              : {}),
            ...(input.cost.currency
              ? { costCurrency: input.cost.currency }
              : {}),
          }
        : {}),
    },
    update: {
      state: input.state,
      completedAt: input.completedAt ?? null,
      retryAt: input.retryAt ?? null,
      httpStatus: input.httpStatus ?? null,
      errorCode: input.errorCode ?? null,
      providerRequestId: input.providerRequestId ?? null,
      cacheOutcome: input.cacheOutcome ?? null,
      budgetUnit: input.cost?.unit ?? null,
      estimatedUnits: input.cost?.estimatedUnits ?? null,
      estimatedCost: input.cost?.estimatedMoney ?? null,
      costCurrency: input.cost?.currency ?? null,
    },
    select: {
      id: true,
      organizationId: true,
      providerKey: true,
      marketplaceId: true,
      capability: true,
      operation: true,
      requestHash: true,
      mode: true,
      state: true,
      attempt: true,
      retryAt: true,
      cacheOutcome: true,
      budgetUnit: true,
      estimatedUnits: true,
      estimatedCost: true,
      costCurrency: true,
      startedAt: true,
      completedAt: true,
    },
  });
}

/** Appends one sanitized access event. Unlike the idempotent probe recorder,
 * this allocator preserves repeated cache reads so usage reporting is not
 * understated across separate jobs or process restarts. */
export async function appendProviderRequestTelemetry(
  input: Omit<Parameters<typeof recordProviderRequestTelemetry>[0], "attempt">,
) {
  for (let retry = 1; retry <= 4; retry += 1) {
    const latest = await db.providerRequestAttempt.aggregate({
      where: {
        organizationId: input.organizationId,
        providerKey: input.providerKey,
        marketplaceId: input.marketplaceId,
        capability: input.capability,
        operation: input.operation,
        requestHash: input.requestHash,
      },
      _max: { attempt: true },
    });
    try {
      return await recordProviderRequestTelemetry({
        ...input,
        attempt: (latest._max.attempt ?? 0) + 1,
      });
    } catch (error) {
      const code =
        error && typeof error === "object" && "code" in error
          ? String(error.code)
          : undefined;
      if (code !== "P2002" || retry === 4) throw error;
    }
  }
  throw new Error("PROVIDER_TELEMETRY_SEQUENCE_EXHAUSTED");
}

/** Bounded, credential-free cache/provider usage projection for Settings. */
export async function getProviderUsageSummary(input: {
  organizationId: string;
  since?: Date;
}) {
  const since = input.since ?? new Date(Date.now() - 30 * 24 * 60 * 60_000);
  const groups = await db.providerRequestAttempt.groupBy({
    by: [
      "providerKey",
      "marketplaceId",
      "mode",
      "capability",
      "state",
      "cacheOutcome",
      "budgetUnit",
      "costCurrency",
    ],
    where: {
      organizationId: input.organizationId,
      startedAt: { gte: since },
    },
    _count: { _all: true },
    _sum: { estimatedUnits: true, estimatedCost: true },
  });
  const totals = {
    liveProviderCalls: 0,
    cacheHits: 0,
    cacheMisses: 0,
    staleHits: 0,
    refreshes: 0,
    throttles: 0,
  };
  const credits = new Map<string, Prisma.Decimal>();
  const costs = new Map<string, Prisma.Decimal>();
  for (const group of groups) {
    const count = group._count._all;
    if (
      group.mode === "LIVE" &&
      ["MISS", "EXPIRED", "FORCED_REFRESH", "STALE_REFRESH"].includes(
        group.cacheOutcome ?? "",
      )
    )
      totals.liveProviderCalls += count;
    if (group.cacheOutcome === "FRESH_HIT") totals.cacheHits += count;
    if (group.cacheOutcome === "MISS") totals.cacheMisses += count;
    if (group.cacheOutcome === "STALE_HIT") totals.staleHits += count;
    if (["FORCED_REFRESH", "STALE_REFRESH"].includes(group.cacheOutcome ?? ""))
      totals.refreshes += count;
    if (group.state === "THROTTLED") totals.throttles += count;
    if (group.budgetUnit && group._sum.estimatedUnits) {
      const key = group.budgetUnit;
      credits.set(
        key,
        (credits.get(key) ?? new Prisma.Decimal(0)).plus(
          group._sum.estimatedUnits,
        ),
      );
    }
    if (group.costCurrency && group._sum.estimatedCost) {
      costs.set(
        group.costCurrency,
        (costs.get(group.costCurrency) ?? new Prisma.Decimal(0)).plus(
          group._sum.estimatedCost,
        ),
      );
    }
  }
  return {
    since: since.toISOString(),
    ...totals,
    estimatedUsage: [...credits.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([unit, value]) => ({ unit, value: value.toFixed(4) })),
    estimatedCost: [...costs.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([currency, value]) => ({ currency, value: value.toFixed(8) })),
    providers: [...new Set(groups.map((group) => group.providerKey))].sort(),
  };
}

export async function providerCapabilityAvailability(input: {
  organizationId: string;
  providerKey: string;
  marketplaceId: string;
  capability: ProviderCapability;
  now?: Date;
}): Promise<ProviderCapabilityState> {
  const row = await db.providerEntitlement.findUnique({
    where: {
      organizationId_providerKey_marketplaceId_capability: {
        organizationId: input.organizationId,
        providerKey: input.providerKey,
        marketplaceId: input.marketplaceId,
        capability: input.capability,
      },
    },
  });
  if (!row)
    return {
      providerKey: input.providerKey,
      marketplaceId: input.marketplaceId,
      capability: input.capability,
      mode: "LIVE",
      state: "NOT_CONFIGURED",
      checkedAt: (input.now ?? new Date()).toISOString(),
      reason: "CAPABILITY_NOT_ENTITLED",
      completeness: "UNKNOWN",
    };
  return capabilityStateDto(row);
}
