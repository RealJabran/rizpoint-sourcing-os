import { db } from "@rizpoint/database";
import { createServer } from "node:http";
import { dispatchOutboxOnce } from "./dispatcher.js";
import { mockScanWorker } from "./processor.js";
import { mockScanQueue, redis } from "./queue.js";
import { scannerReady } from "./scanner-client.js";

function redactError(error: unknown): string {
  const message = error instanceof Error ? error.message : "unknown error";
  return message.replace(/:\/\/[^\s:@]+:[^\s@]+@/g, "://[redacted]@");
}

let stopping = false;

async function tick(): Promise<void> {
  if (stopping) return;
  try {
    await dispatchOutboxOnce();
  } catch (error) {
    console.error("outbox_dispatch_failed", { message: redactError(error) });
  }
}

const interval = setInterval(() => void tick(), 250);
void tick();

const healthServer = createServer(async (request, response) => {
  if (request.url === "/health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ status: "ok", service: "worker" }));
    return;
  }
  if (request.url === "/ready") {
    try {
      const [scannerIsReady] = await Promise.all([
        scannerReady(),
        redis.ping(),
        db.$queryRaw`SELECT 1`,
      ]);
      if (!scannerIsReady) throw new Error("scanner is not ready");
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ status: "ready", service: "worker" }));
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
  healthServer.close();
  console.info(`worker_shutdown:${signal}`);
  await mockScanWorker.close();
  await mockScanQueue.close();
  await redis.quit();
  await db.$disconnect();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
