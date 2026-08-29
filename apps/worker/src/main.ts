import { db } from "@rizpoint/database";
import { evaluateDueAlertRules } from "@rizpoint/database";
import { evaluateSecuritySignals } from "@rizpoint/database";
import { requeueDueHistoryRefreshRuns } from "@rizpoint/database";
import { storageReady } from "@rizpoint/object-storage";
import { createServer } from "node:http";
import { dispatchOutboxOnce } from "./dispatcher.js";
import { mockScanWorker } from "./processor.js";
import { mockScanQueue, redis } from "./queue.js";
import { scannerReady } from "./scanner-client.js";
import {
  dependencyReady,
  logger,
  metrics,
  redactText,
} from "./observability.js";
import { runRetentionOnce } from "./retention.js";
import { assertWorkerProductionConfiguration } from "./runtime-config.js";
import { reportOperationalError } from "./error-tracking.js";

assertWorkerProductionConfiguration();

function redactError(error: unknown): string {
  const message = error instanceof Error ? error.message : "unknown error";
  return redactText(message);
}

let stopping = false;
let scheduling = false;

async function tick(): Promise<void> {
  if (stopping) return;
  try {
    await dispatchOutboxOnce();
  } catch (error) {
    logger.error({
      event: "outbox_dispatch_failed",
      message: redactError(error),
    });
    void reportOperationalError({
      event: "outbox_dispatch_failed",
      error,
    }).catch(() => undefined);
  }
}

async function scheduleDueResearchWork(): Promise<void> {
  if (stopping || scheduling) return;
  scheduling = true;
  try {
    const queued = await requeueDueHistoryRefreshRuns();
    if (queued)
      logger.info({ event: "history_retries_scheduled", jobCount: queued });
  } catch (error) {
    logger.error({
      event: "history_retry_scheduler_failed",
      message: redactError(error),
    });
  } finally {
    scheduling = false;
  }
}

const interval = setInterval(() => void tick(), 250);
void tick();
const researchScheduleInterval = setInterval(
  () => void scheduleDueResearchWork(),
  60_000,
);
void scheduleDueResearchWork();
const retentionInterval = setInterval(
  () => {
    void runRetentionOnce().catch((error) => {
      logger.error({ event: "retention_failed", message: redactError(error) });
      void reportOperationalError({ event: "retention_failed", error }).catch(
        () => undefined,
      );
    });
  },
  6 * 60 * 60_000,
);
const alertInterval = setInterval(
  () =>
    void evaluateDueAlertRules().catch((error) =>
      logger.error({
        event: "alert_evaluation_failed",
        message: redactError(error),
      }),
    ),
  5 * 60_000,
);
void evaluateDueAlertRules().catch(() => undefined);
const securitySignalInterval = setInterval(
  () =>
    void evaluateSecuritySignals().catch((error) => {
      logger.error({
        event: "security_signal_evaluation_failed",
        message: redactError(error),
      });
      void reportOperationalError({
        event: "security_signal_evaluation_failed",
        error,
      }).catch(() => undefined);
    }),
  5 * 60_000,
);
void evaluateSecuritySignals().catch((error) =>
  logger.error({
    event: "security_signal_evaluation_failed",
    message: redactError(error),
  }),
);

const healthServer = createServer(async (request, response) => {
  if (request.url === "/health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ status: "ok", service: "worker" }));
    return;
  }
  if (request.url === "/metrics") {
    response.writeHead(200, { "content-type": metrics.contentType });
    response.end(await metrics.metrics());
    return;
  }
  if (request.url === "/ready") {
    try {
      const [scannerIsReady, redisReady, databaseReady, objectStorageIsReady] =
        await Promise.all([
          scannerReady(),
          redis.ping(),
          db.$queryRaw`SELECT 1`,
          storageReady(),
        ]);
      dependencyReady.set({ dependency: "scanner" }, scannerIsReady ? 1 : 0);
      dependencyReady.set({ dependency: "redis" }, redisReady ? 1 : 0);
      dependencyReady.set({ dependency: "database" }, databaseReady ? 1 : 0);
      dependencyReady.set(
        { dependency: "object_storage" },
        objectStorageIsReady ? 1 : 0,
      );
      if (!scannerIsReady || !objectStorageIsReady)
        throw new Error("dependency is not ready");
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          status: "ready",
          service: "worker",
          release: process.env.RIZPOINT_RELEASE_SHA ?? "development",
        }),
      );
    } catch {
      response.writeHead(503, { "content-type": "application/json" });
      response.end(JSON.stringify({ status: "not_ready", service: "worker" }));
    }
    return;
  }
  response.writeHead(404);
  response.end();
});
healthServer.listen(3001, "0.0.0.0");

async function shutdown(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  clearInterval(interval);
  clearInterval(researchScheduleInterval);
  clearInterval(retentionInterval);
  clearInterval(alertInterval);
  clearInterval(securitySignalInterval);
  healthServer.close();
  logger.info({ event: "worker_shutdown", signal });
  await mockScanWorker.close();
  await mockScanQueue.close();
  await redis.quit();
  await db.$disconnect();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
