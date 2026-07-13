import {
  claimPendingOutboxEvents,
  markOutboxPublished,
  resetOutboxEvent,
} from "@rizpoint/database";
import { mockScanQueueJobId, type UploadJobKind } from "./job-policy.js";
import { mockScanQueue } from "./queue.js";

export async function dispatchOutboxOnce(): Promise<number> {
  const events = await claimPendingOutboxEvents(25);
  for (const event of events) {
    try {
      const payload = event.payload as {
        scanJobId: string;
        kind?: Exclude<UploadJobKind, "MOCK">;
        runAttempt?: number;
        runId?: string;
      };
      await mockScanQueue.add("mock-scan", payload, {
        jobId: mockScanQueueJobId(
          payload.scanJobId,
          payload.kind ?? "MOCK",
          payload.runAttempt,
          payload.runId,
        ),
        attempts: 3,
        backoff: { type: "exponential", delay: 1_000 },
        removeOnComplete: 100,
        removeOnFail: 100,
      });
      await markOutboxPublished(event.id, event.claimToken);
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
