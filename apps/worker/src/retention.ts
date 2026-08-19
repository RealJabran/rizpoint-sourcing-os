import {
  acknowledgeExpiredExportObject,
  acknowledgeExpiredProviderEvidence,
  deleteExpiredHistoricalMetricPoints,
  listExpiredHistoricalMetricPoints,
  listExpiredProviderEvidence,
  listExpiredExportObjects,
  recordExpiredExportRetentionReport,
} from "@rizpoint/database";
import { deletePrivateObject } from "@rizpoint/object-storage";
import { logger } from "./observability.js";

/** Export deletion is intentionally report-only until an operator enables it. */
export async function runRetentionOnce(now = new Date()): Promise<number> {
  const expired = await listExpiredExportObjects(now);
  const providerEvidence = await listExpiredProviderEvidence(now);
  const historicalPoints = await listExpiredHistoricalMetricPoints(now);
  if (process.env.RIZPOINT_RETENTION_MODE !== "delete") {
    await recordExpiredExportRetentionReport(expired, now);
    logger.info({
      event: "retention_report",
      exportObjectCount: expired.length,
      providerEvidenceCount: providerEvidence.length,
      historicalPointCount: historicalPoints.length,
    });
    return expired.length + providerEvidence.length + historicalPoints.length;
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
  });
  return expired.length + providerEvidence.length + historicalPointCount;
}
