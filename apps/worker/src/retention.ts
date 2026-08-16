import {
  acknowledgeExpiredExportObject,
  acknowledgeExpiredProviderEvidence,
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
  if (process.env.RIZPOINT_RETENTION_MODE !== "delete") {
    await recordExpiredExportRetentionReport(expired, now);
    logger.info({
      event: "retention_report",
      exportObjectCount: expired.length,
    });
    return expired.length + providerEvidence.length;
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
  logger.info({
    event: "retention_deleted",
    exportObjectCount: expired.length,
  });
  return expired.length + providerEvidence.length;
}
