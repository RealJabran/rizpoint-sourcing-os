import type { Prisma } from "../generated/prisma/client.js";
import { db } from "../client.js";

export type PersistHistoryAnalyticsInput = {
  organizationId: string;
  catalogProductId: string;
  marketplaceId: string;
  providerKey: string;
  calculationVersion: string;
  inputFingerprint: string;
  status: "COMPLETE" | "PARTIAL" | "INSUFFICIENT_DATA";
  windowStart?: Date;
  windowEnd: Date;
  coveragePercent?: string;
  metrics: Prisma.InputJsonValue;
  warnings: readonly string[];
  inputPointReferences: Prisma.InputJsonValue;
  calculatedAt: Date;
};

/** Loads only organization-owned normalized history. Derived analytics never
 * read opaque provider payloads and can therefore be replayed deterministically. */
export async function getHistoryAnalyticsSource(input: {
  organizationId: string;
  catalogProductId: string;
  marketplaceId: string;
  providerKey: string;
}) {
  return db.historicalMetricSeries.findMany({
    where: {
      organizationId: input.organizationId,
      catalogProductId: input.catalogProductId,
      marketplaceId: input.marketplaceId,
      providerKey: input.providerKey,
      subjectType: "PRODUCT",
    },
    select: {
      metricKey: true,
      providerKey: true,
      unit: true,
      currency: true,
      points: {
        select: {
          id: true,
          metricAt: true,
          decimalValue: true,
          integerValue: true,
          booleanValue: true,
          textValue: true,
        },
        orderBy: { metricAt: "asc" },
      },
    },
  });
}

/** The unique input fingerprint makes reprocessing the same point set a
 * no-op, while preserving immutable prior calculation versions. */
export async function persistHistoryAnalytics(
  input: PersistHistoryAnalyticsInput,
) {
  return db.historyAnalyticsAssessment.upsert({
    where: {
      organizationId_catalogProductId_marketplaceId_providerKey_calculationVersion_inputFingerprint:
        {
          organizationId: input.organizationId,
          catalogProductId: input.catalogProductId,
          marketplaceId: input.marketplaceId,
          providerKey: input.providerKey,
          calculationVersion: input.calculationVersion,
          inputFingerprint: input.inputFingerprint,
        },
    },
    create: {
      organizationId: input.organizationId,
      catalogProductId: input.catalogProductId,
      marketplaceId: input.marketplaceId,
      providerKey: input.providerKey,
      calculationVersion: input.calculationVersion,
      inputFingerprint: input.inputFingerprint,
      status: input.status,
      windowStart: input.windowStart ?? null,
      windowEnd: input.windowEnd,
      coveragePercent: input.coveragePercent ?? null,
      metrics: input.metrics,
      warnings: [...input.warnings],
      inputPointReferences: input.inputPointReferences,
      calculatedAt: input.calculatedAt,
    },
    update: {},
  });
}

export async function getLatestHistoryAnalytics(input: {
  organizationId: string;
  catalogProductId: string;
}) {
  return db.historyAnalyticsAssessment.findMany({
    where: {
      organizationId: input.organizationId,
      catalogProductId: input.catalogProductId,
    },
    select: {
      providerKey: true,
      calculationVersion: true,
      status: true,
      windowStart: true,
      windowEnd: true,
      coveragePercent: true,
      metrics: true,
      warnings: true,
      inputPointReferences: true,
      calculatedAt: true,
    },
    orderBy: { calculatedAt: "desc" },
    take: 3,
  });
}
