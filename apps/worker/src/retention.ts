import {
  acknowledgeExpiredExportObject,
  listExpiredExportObjects,
  recordExpiredExportRetentionReport,
} from "@rizpoint/database";
import { deletePrivateObject } from "@rizpoint/object-storage";
import { logger } from "./observability.js";

/** Export deletion is intentionally report-only until an operator enables it. */
export async function runRetentionOnce(now = new Date()): Promise<number> {
  const expired = await listExpiredExportObjects(now);
  if (process.env.RIZPOINT_RETENTION_MODE !== "delete") {
    await recordExpiredExportRetentionReport(expired, now);
    logger.info({
      event: "retention_report",
      exportObjectCount: expired.length,
    });
    return expired.length;
  }
  for (const item of expired) {
    if (!item.objectKey) continue;
    await deletePrivateObject(item.objectKey);
    await acknowledgeExpiredExportObject(item.id, item.organizationId);
  }
  logger.info({
    event: "retention_deleted",
    exportObjectCount: expired.length,
  });
  return expired.length;
}
