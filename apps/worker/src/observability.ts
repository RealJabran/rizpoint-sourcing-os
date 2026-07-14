import pino from "pino";
import { Counter, Gauge, Registry, collectDefaultMetrics } from "prom-client";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: {
    paths: [
      "*.password",
      "*.token",
      "*.secret",
      "*.authorization",
      "*.refreshToken",
      "*.content_base64",
      "*.payload",
      "*.rawPayload",
      "*.body",
      "*.headers",
      "req.headers.authorization",
    ],
    censor: "[redacted]",
  },
});

/** Do not allow provider or credential-shaped text through error messages. */
export function redactText(value: string): string {
  return value
    .replace(/https?:\/\/[^\s:@]+:[^\s@]+@/g, "[redacted-url]")
    .replace(/\b(?:bearer\s+)[^\s,;]+/gi, "Bearer [redacted]")
    .replace(
      /\b(?:access[_-]?token|refresh[_-]?token|client[_-]?secret|password|authorization)\s*[=:]\s*[^\s,;]+/gi,
      "[redacted]",
    );
}

export const metrics = new Registry();
collectDefaultMetrics({ register: metrics, prefix: "rizpoint_worker_" });
export const jobFailures = new Counter({
  name: "rizpoint_worker_job_failures_total",
  help: "Worker jobs that threw",
  labelNames: ["kind"] as const,
  registers: [metrics],
});
export const outboxPublished = new Counter({
  name: "rizpoint_worker_outbox_published_total",
  help: "Outbox events published",
  registers: [metrics],
});
export const outboxReconciled = new Counter({
  name: "rizpoint_worker_outbox_reconciled_total",
  help: "Published events returned to pending because their target was unfinished",
  registers: [metrics],
});
export const dependencyReady = new Gauge({
  name: "rizpoint_worker_dependency_ready",
  help: "Dependency readiness",
  labelNames: ["dependency"] as const,
  registers: [metrics],
});
export const providerCalls = new Counter({
  name: "rizpoint_worker_provider_calls_total",
  help: "Provider calls by operation and outcome",
  labelNames: ["operation", "outcome"] as const,
  registers: [metrics],
});
