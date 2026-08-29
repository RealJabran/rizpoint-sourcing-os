import {
  acknowledgeExpiredExportObject,
  acknowledgeExpiredProviderEvidence,
  deleteExpiredApiRateLimitBuckets,
  deleteExpiredHistoricalMetricPoints,
  listExpiredHistoricalMetricPoints,
  listExpiredProviderEvidence,
  listExpiredExportObjects,
  recordExpiredExportRetentionReport,
  completeAmazonDeletionRequest,
  deleteAmazonInformationCandidates,
  listAmazonInformationCandidates,
  listOrganizationsWithAmazonInformation,
  listPendingAmazonDeletionScopes,
  markAmazonDeletionAttempt,
  markAmazonTombstoneReapplied,
  minimizeExpiredGlobalAmazonCatalogProducts,
  recordAmazonRetentionRun,
  type AmazonDeletionCounts,
} from "@rizpoint/database";
import { deletePrivateObject } from "@rizpoint/object-storage";
import { logger } from "./observability.js";

const amazonEmptyCounts = (): AmazonDeletionCounts => ({
  PROVIDER_CACHE: 0,
  PROVIDER_OBSERVATION: 0,
  RESEARCH_OBSERVATION: 0,
  PRODUCT_RESEARCH_ITEM: 0,
  MARKETPLACE_PARTICIPATION: 0,
  HISTORICAL_POINT: 0,
  PROJECT_EVIDENCE: 0,
  DECISION_SOURCE: 0,
});

function countDeleted(counts: AmazonDeletionCounts) {
  return Object.values(counts).reduce((sum, value) => sum + value, 0);
}

async function deleteAmazonBatch(input: {
  organizationId: string;
  now: Date;
  cutoffAt?: Date;
  marketplaceId?: string;
  reason: "RETENTION_EXPIRY" | "DELETION_REQUEST" | "TOMBSTONE_REPLAY";
}) {
  const candidates = await listAmazonInformationCandidates(input);
  const confirmed = new Set<string>();
  const failures: string[] = [];
  for (const candidate of candidates) {
    if (!candidate.objectReference) continue;
    try {
      await deletePrivateObject(candidate.objectReference);
      confirmed.add(candidate.id);
    } catch {
      failures.push(candidate.id);
    }
  }
  const counts = await deleteAmazonInformationCandidates({
    organizationId: input.organizationId,
    candidates,
    objectDeletionConfirmedIds: confirmed,
    now: input.now,
    reason: input.reason,
  });
  return { candidates, counts, failures };
}

/** Amazon lifecycle deletion is enforceable by default. An operator may use
 * explicit report mode only for a dry-run migration rehearsal. */
export async function runAmazonInformationRetentionOnce(now = new Date()) {
  const reportOnly = process.env.RIZPOINT_AMAZON_RETENTION_MODE === "report";
  let affected = 0;
  const organizations = await listOrganizationsWithAmazonInformation();
  for (const organizationId of organizations) {
    const startedAt = new Date();
    const candidates = await listAmazonInformationCandidates({
      organizationId,
      now,
    });
    if (reportOnly) {
      logger.info({
        event: "amazon_information_retention_report",
        organizationId,
        candidateCount: candidates.length,
        payloadLogged: false,
      });
      affected += candidates.length;
      continue;
    }
    try {
      const result = await deleteAmazonBatch({
        organizationId,
        now,
        reason: "RETENTION_EXPIRY",
      });
      affected += countDeleted(result.counts);
      await recordAmazonRetentionRun({
        organizationId,
        mode: "RETENTION_EXPIRY",
        cutoffAt: now,
        status: result.failures.length ? "PARTIAL_FAILURE" : "COMPLETED",
        deletedCounts: result.counts,
        ...(result.failures.length
          ? { failureCode: "OBJECT_DELETION_RETRY_REQUIRED" }
          : {}),
        startedAt,
        completedAt: new Date(),
      });
    } catch {
      await recordAmazonRetentionRun({
        organizationId,
        mode: "RETENTION_EXPIRY",
        cutoffAt: now,
        status: "FAILED",
        deletedCounts: amazonEmptyCounts(),
        failureCode: "RETENTION_BATCH_FAILED",
        startedAt,
        completedAt: new Date(),
      });
      logger.error({
        event: "amazon_information_retention_failed",
        organizationId,
      });
    }
  }

  const { requests, tombstones } = await listPendingAmazonDeletionScopes();
  for (const request of requests) {
    const startedAt = new Date();
    try {
      await markAmazonDeletionAttempt({
        requestId: request.id,
        status: "PROCESSING",
        now,
      });
      const result = await deleteAmazonBatch({
        organizationId: request.organizationId,
        now,
        cutoffAt: request.cutoffAt,
        ...(request.marketplaceId
          ? { marketplaceId: request.marketplaceId }
          : {}),
        reason: "DELETION_REQUEST",
      });
      affected += countDeleted(result.counts);
      if (result.failures.length) {
        await markAmazonDeletionAttempt({
          requestId: request.id,
          status: "PARTIAL_FAILURE",
          failureCode: "OBJECT_DELETION_RETRY_REQUIRED",
          now,
        });
      } else {
        const remaining = await listAmazonInformationCandidates({
          organizationId: request.organizationId,
          now,
          cutoffAt: request.cutoffAt,
          ...(request.marketplaceId
            ? { marketplaceId: request.marketplaceId }
            : {}),
          limit: 1,
        });
        if (!remaining.length)
          await completeAmazonDeletionRequest({
            requestId: request.id,
            organizationId: request.organizationId,
            deletedCounts: result.counts,
            now,
          });
      }
      await recordAmazonRetentionRun({
        organizationId: request.organizationId,
        mode: "DELETION_REQUEST",
        cutoffAt: request.cutoffAt,
        status: result.failures.length ? "PARTIAL_FAILURE" : "COMPLETED",
        deletedCounts: result.counts,
        ...(result.failures.length
          ? { failureCode: "OBJECT_DELETION_RETRY_REQUIRED" }
          : {}),
        startedAt,
        completedAt: new Date(),
      });
    } catch {
      await markAmazonDeletionAttempt({
        requestId: request.id,
        status: "PARTIAL_FAILURE",
        failureCode: "DELETION_BATCH_RETRY_REQUIRED",
        now,
      });
      logger.error({
        event: "amazon_deletion_request_failed",
        organizationId: request.organizationId,
        requestId: request.id,
      });
    }
  }

  // Tombstones are replayed every cycle. After a restored backup introduces
  // eligible data, it is deleted before the tombstone timestamp advances.
  for (const tombstone of tombstones) {
    const result = await deleteAmazonBatch({
      organizationId: tombstone.organizationId,
      now,
      cutoffAt: tombstone.cutoffAt,
      ...(tombstone.marketplaceId
        ? { marketplaceId: tombstone.marketplaceId }
        : {}),
      reason: "TOMBSTONE_REPLAY",
    });
    affected += countDeleted(result.counts);
    if (!result.failures.length)
      await markAmazonTombstoneReapplied(tombstone.id, now);
  }
  affected += await minimizeExpiredGlobalAmazonCatalogProducts(now);
  return affected;
}

/** Export deletion is intentionally report-only until an operator enables it. */
export async function runRetentionOnce(now = new Date()): Promise<number> {
  const amazonInformationCount = await runAmazonInformationRetentionOnce(now);
  const expired = await listExpiredExportObjects(now);
  const providerEvidence = await listExpiredProviderEvidence(now);
  const historicalPoints = await listExpiredHistoricalMetricPoints(now);
  const apiRateLimitBucketCount = await deleteExpiredApiRateLimitBuckets(now);
  if (process.env.RIZPOINT_RETENTION_MODE !== "delete") {
    await recordExpiredExportRetentionReport(expired, now);
    logger.info({
      event: "retention_report",
      exportObjectCount: expired.length,
      providerEvidenceCount: providerEvidence.length,
      historicalPointCount: historicalPoints.length,
      apiRateLimitBucketCount,
      amazonInformationCount,
    });
    return (
      expired.length +
      providerEvidence.length +
      historicalPoints.length +
      apiRateLimitBucketCount +
      amazonInformationCount
    );
  }
  for (const item of expired) {
    if (!item.objectKey) continue;
    await deletePrivateObject(item.objectKey);
    await acknowledgeExpiredExportObject(item.id, item.organizationId);
  }
  for (const evidence of providerEvidence) {
    if (!evidence.rawEvidenceReference) continue;
    await deletePrivateObject(evidence.rawEvidenceReference);
    await acknowledgeExpiredProviderEvidence(evidence.id);
  }
  const historicalPointCount = await deleteExpiredHistoricalMetricPoints(
    historicalPoints,
    now,
  );
  logger.info({
    event: "retention_deleted",
    exportObjectCount: expired.length,
    providerEvidenceCount: providerEvidence.length,
    historicalPointCount,
    apiRateLimitBucketCount,
    amazonInformationCount,
  });
  return (
    expired.length +
    providerEvidence.length +
    historicalPointCount +
    apiRateLimitBucketCount +
    amazonInformationCount
  );
}
