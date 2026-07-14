import {
  claimPendingOutboxEvents,
  markOutboxPublished,
  recoverPublishedOutboxEvents,
  resetOutboxEvent,
} from "@rizpoint/database";
import { mockScanQueueJobId, type UploadJobKind } from "./job-policy.js";
import { mockScanQueue } from "./queue.js";
import { outboxPublished, outboxReconciled } from "./observability.js";

export async function dispatchOutboxOnce(): Promise<number> {
  const reconciled = await recoverPublishedOutboxEvents(25);
  if (reconciled) outboxReconciled.inc(reconciled);
  const events = await claimPendingOutboxEvents(25);
  for (const event of events) {
    try {
      const payload = event.payload as {
        scanJobId?: string;
        exportJobId?: string;
        kind?: Exclude<UploadJobKind, "MOCK"> | "EXPORT";
        runAttempt?: number;
        runId?: string;
        notBefore?: string;
      };
      if (payload.kind === "EXPORT" && !payload.exportJobId)
        throw new Error("export_job_id_missing");
      if (payload.kind !== "EXPORT" && !payload.scanJobId)
        throw new Error("scan_job_id_missing");
      const notBefore = payload.notBefore ? Date.parse(payload.notBefore) : NaN;
      await mockScanQueue.add("mock-scan", payload, {
        jobId:
          payload.kind === "EXPORT"
            ? `export-${payload.exportJobId}`
            : mockScanQueueJobId(
                payload.scanJobId!,
                payload.kind ?? "MOCK",
                payload.runAttempt,
                payload.runId,
              ),
        attempts: 3,
        backoff: { type: "exponential", delay: 1_000 },
        ...(Number.isFinite(notBefore) && notBefore > Date.now()
          ? { delay: notBefore - Date.now() }
          : {}),
        removeOnComplete: 100,
        removeOnFail: 100,
      });
      await markOutboxPublished(event.id, event.claimToken);
      outboxPublished.inc();
    } catch (error) {
      await resetOutboxEvent(
        event.id,
        event.claimToken,
        "outbox_publish_failed",
      );
      throw error;
    }
  }
  return events.length;
}
