import { createHash } from "node:crypto";
import { Prisma } from "../generated/prisma/client.js";
import { db } from "../client.js";
import {
  estimateWithCalibratedModel,
  useLicensedProviderEstimate,
  type CalibratedSalesModel,
} from "@rizpoint/sales-estimation";
import type { SalesEstimateProviderResult } from "@rizpoint/provider-contracts";

function hash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function ownedProduct(organizationId: string, asin: string) {
  const rows = await db.$queryRaw<
    Array<{
      id: string;
      asin: string | null;
      marketplaceId: string | null;
      categoryReference: string | null;
    }>
  >(Prisma.sql`
    WITH allowed AS (
      SELECT catalog_product_id AS id FROM listing_candidates WHERE organization_id = ${organizationId}
      UNION SELECT catalog_product_id FROM research_project_items WHERE organization_id = ${organizationId} AND kind = 'PRODUCT' AND catalog_product_id IS NOT NULL
      UNION SELECT catalog_product_id FROM product_watches WHERE organization_id = ${organizationId} AND status = 'ACTIVE'
      UNION SELECT catalog_product_id FROM market_members WHERE organization_id = ${organizationId} AND left_at IS NULL
      UNION SELECT catalog_product_id FROM history_refresh_items WHERE organization_id = ${organizationId} AND catalog_product_id IS NOT NULL
    ) SELECT cp.id, cp.asin, cp.marketplace_id AS "marketplaceId", cp.identity_projection -> 'productTypes' ->> 0 AS "categoryReference"
      FROM allowed JOIN catalog_products cp ON cp.id = allowed.id WHERE cp.asin = ${asin} LIMIT 1`);
  return rows[0] ?? null;
}

function modelProjection(row: {
  marketplaceId: string;
  categoryReference: string;
  version: string;
  status: string;
  referenceDatasetId: string;
  referenceDatasetSource: string;
  referenceSampleSize: number;
  parameters: Prisma.JsonValue;
}): CalibratedSalesModel | null {
  if (
    !row.parameters ||
    typeof row.parameters !== "object" ||
    Array.isArray(row.parameters)
  )
    return null;
  const parameters = row.parameters as Record<string, unknown>;
  if (
    !Array.isArray(parameters.rankBands) ||
    typeof parameters.minimumHistoryPoints !== "number"
  )
    return null;
  return {
    marketplaceId: row.marketplaceId,
    categoryReference: row.categoryReference,
    version: row.version,
    status: row.status as CalibratedSalesModel["status"],
    referenceDataset: {
      id: row.referenceDatasetId,
      sourceReference: row.referenceDatasetSource,
      sampleSize: row.referenceSampleSize,
      observedFrom: String(parameters.observedFrom ?? ""),
      observedTo: String(parameters.observedTo ?? ""),
    },
    minimumHistoryPoints: parameters.minimumHistoryPoints,
    rankBands: parameters.rankBands as CalibratedSalesModel["rankBands"],
  };
}

export async function registerSalesEstimationModel(input: {
  organizationId: string;
  marketplaceId: string;
  categoryReference: string;
  version: string;
  referenceDatasetId: string;
  referenceDatasetSource: string;
  referenceSampleSize: number;
  parameters: Prisma.InputJsonValue;
  evaluationMetrics: Prisma.InputJsonValue;
  validated: boolean;
}) {
  if (
    !input.referenceDatasetId.trim() ||
    !input.referenceDatasetSource.trim() ||
    input.referenceSampleSize <= 0
  )
    throw new Error("CALIBRATION_REFERENCE_DATASET_REQUIRED");
  return db.salesEstimationModel.upsert({
    where: {
      organizationId_marketplaceId_categoryReference_version: {
        organizationId: input.organizationId,
        marketplaceId: input.marketplaceId,
        categoryReference: input.categoryReference,
        version: input.version,
      },
    },
    create: {
      organizationId: input.organizationId,
      marketplaceId: input.marketplaceId,
      categoryReference: input.categoryReference,
      version: input.version,
      status: input.validated ? "VALIDATED" : "DRAFT",
      referenceDatasetId: input.referenceDatasetId,
      referenceDatasetSource: input.referenceDatasetSource,
      referenceSampleSize: input.referenceSampleSize,
      parameters: input.parameters,
      evaluationMetrics: input.evaluationMetrics,
      validatedAt: input.validated ? new Date() : null,
    },
    update: {},
  });
}

export async function estimateSalesForAsin(input: {
  organizationId: string;
  asin: string;
}) {
  const product = await ownedProduct(input.organizationId, input.asin);
  if (!product)
    return {
      status: "UNAVAILABLE" as const,
      source: "NONE" as const,
      reasonCode: "PRODUCT_NOT_IN_ORGANIZATION_UNIVERSE",
      provenanceReferences: [],
    };
  if (!product.marketplaceId || !product.categoryReference)
    return {
      status: "UNAVAILABLE" as const,
      source: "NONE" as const,
      reasonCode: "MARKETPLACE_OR_CATEGORY_UNAVAILABLE",
      provenanceReferences: [],
    };
  const [series, modelRow] = await Promise.all([
    db.historicalMetricSeries.findFirst({
      where: {
        organizationId: input.organizationId,
        catalogProductId: product.id,
        marketplaceId: product.marketplaceId,
        metricKey: "SALES_RANK",
      },
      select: {
        points: {
          orderBy: { metricAt: "asc" },
          select: { id: true, integerValue: true, metricAt: true },
        },
      },
    }),
    db.salesEstimationModel.findFirst({
      where: {
        organizationId: input.organizationId,
        marketplaceId: product.marketplaceId,
        categoryReference: product.categoryReference,
        status: "VALIDATED",
      },
      orderBy: { validatedAt: "desc" },
    }),
  ]);
  const model = modelRow ? modelProjection(modelRow) : null;
  const rankHistory = (series?.points ?? []).flatMap((point) =>
    point.integerValue === null
      ? []
      : [
          {
            rank: point.integerValue.toString(),
            observedAt: point.metricAt.toISOString(),
            evidenceReference: point.id,
          },
        ],
  );
  const result = estimateWithCalibratedModel(
    {
      marketplaceId: product.marketplaceId,
      categoryReference: product.categoryReference,
      salesRankHistory: rankHistory,
    },
    model ?? undefined,
  );
  if (
    result.status !== "AVAILABLE" ||
    !result.monthlyUnitsLow ||
    !result.monthlyUnitsHigh ||
    !result.modelVersion ||
    !modelRow
  )
    return result;
  const inputFingerprint = hash({ productId: product.id, result, rankHistory });
  await db.salesEstimate.upsert({
    where: {
      organizationId_catalogProductId_source_modelVersion_inputFingerprint: {
        organizationId: input.organizationId,
        catalogProductId: product.id,
        source: "RIZPOINT_CALIBRATED_MODEL",
        modelVersion: result.modelVersion,
        inputFingerprint,
      },
    },
    create: {
      organizationId: input.organizationId,
      catalogProductId: product.id,
      marketplaceId: product.marketplaceId,
      categoryReference: product.categoryReference,
      source: "RIZPOINT_CALIBRATED_MODEL",
      monthlyUnitsLow: result.monthlyUnitsLow,
      monthlyUnitsCentral: result.monthlyUnitsCentral ?? null,
      monthlyUnitsHigh: result.monthlyUnitsHigh,
      confidencePercent: result.confidencePercent ?? null,
      modelId: modelRow.id,
      modelVersion: result.modelVersion,
      inputFingerprint,
      inputEvidenceReferences: result.provenanceReferences,
      observedAt: new Date(),
    },
    update: {},
  });
  return result;
}

export async function persistLicensedSalesEstimate(input: {
  organizationId: string;
  catalogProductId: string;
  marketplaceId: string;
  categoryReference?: string;
  providerKey: string;
  result: SalesEstimateProviderResult;
}) {
  const estimate = useLicensedProviderEstimate(input.result);
  if (
    estimate.status !== "AVAILABLE" ||
    !estimate.monthlyUnitsLow ||
    !estimate.monthlyUnitsHigh ||
    !estimate.modelVersion
  )
    return estimate;
  const inputFingerprint = hash({
    providerKey: input.providerKey,
    result: input.result,
  });
  await db.salesEstimate.upsert({
    where: {
      organizationId_catalogProductId_source_modelVersion_inputFingerprint: {
        organizationId: input.organizationId,
        catalogProductId: input.catalogProductId,
        source: "LICENSED_PROVIDER",
        modelVersion: estimate.modelVersion,
        inputFingerprint,
      },
    },
    create: {
      organizationId: input.organizationId,
      catalogProductId: input.catalogProductId,
      marketplaceId: input.marketplaceId,
      categoryReference: input.categoryReference ?? null,
      source: "LICENSED_PROVIDER",
      monthlyUnitsLow: estimate.monthlyUnitsLow,
      monthlyUnitsCentral: estimate.monthlyUnitsCentral ?? null,
      monthlyUnitsHigh: estimate.monthlyUnitsHigh,
      confidencePercent: estimate.confidencePercent ?? null,
      providerKey: input.providerKey,
      modelVersion: estimate.modelVersion,
      inputFingerprint,
      inputEvidenceReferences: estimate.provenanceReferences,
      observedAt: new Date(input.result.provenance.observedAt),
    },
    update: {},
  });
  return estimate;
}
