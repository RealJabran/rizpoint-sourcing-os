import { createHash } from "node:crypto";
import { Prisma } from "../generated/prisma/client.js";
import { db } from "../client.js";
import { RETENTION_BATCH_SIZE } from "../research-performance.js";

export type ExpiredHistoricalPoint = {
  id: string;
  organizationId: string;
};

/** Uses each series' explicit retention policy and returns a bounded oldest-
 * first batch. The global BRIN time index narrows old pages; the tenant/series
 * btree supports the ownership join. */
export async function listExpiredHistoricalMetricPoints(
  now = new Date(),
  limit = RETENTION_BATCH_SIZE,
) {
  if (!Number.isInteger(limit) || limit < 1 || limit > RETENTION_BATCH_SIZE)
    throw new Error("RETENTION_BATCH_LIMIT_INVALID");
  return db.$queryRaw<ExpiredHistoricalPoint[]>(Prisma.sql`
    SELECT point.id, point.organization_id AS "organizationId"
    FROM historical_metric_points point
    JOIN historical_metric_series series
      ON series.id = point.series_id
     AND series.organization_id = point.organization_id
    WHERE point.metric_at < ${now} - make_interval(days => series.retention_days)
    ORDER BY point.metric_at ASC, point.id ASC
    LIMIT ${limit}
  `);
}

export async function deleteExpiredHistoricalMetricPoints(
  items: readonly ExpiredHistoricalPoint[],
  now = new Date(),
) {
  if (items.length > RETENTION_BATCH_SIZE)
    throw new Error("RETENTION_BATCH_LIMIT_INVALID");
  const byOrganization = new Map<string, string[]>();
  for (const item of items)
    byOrganization.set(item.organizationId, [
      ...(byOrganization.get(item.organizationId) ?? []),
      item.id,
    ]);
  let deletedCount = 0;
  for (const [organizationId, ids] of byOrganization) {
    const deleted = await db.$transaction(async (transaction) => {
      const rows = await transaction.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`
          DELETE FROM historical_metric_points point
          USING historical_metric_series series
          WHERE point.id IN (${Prisma.join(ids)})
            AND point.organization_id = ${organizationId}
            AND series.id = point.series_id
            AND series.organization_id = point.organization_id
            AND point.metric_at < ${now} - make_interval(days => series.retention_days)
          RETURNING point.id
        `,
      );
      if (!rows.length) return 0;
      const fingerprint = createHash("sha256")
        .update(
          rows
            .map((row) => row.id)
            .sort()
            .join(":"),
        )
        .digest("hex")
        .slice(0, 24);
      await transaction.workflowAuditEvent.create({
        data: {
          organizationId,
          entityType: "HistoricalMetricPoint",
          entityId: "retention-batch",
          eventType: "history.retention_deleted",
          idempotencyKey: `history-retention:${fingerprint}`,
          payload: {
            deletedCount: rows.length,
            policy: "series.retentionDays",
            deletedAt: now.toISOString(),
          },
        },
      });
      return rows.length;
    });
    deletedCount += deleted;
  }
  return deletedCount;
}
