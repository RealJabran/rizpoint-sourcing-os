import { redactText } from "./observability.js";

/**
 * Deployment supplies a private HTTPS collector (for example a self-hosted
 * error tracker). Only allowlisted operational metadata is emitted.
 */
export async function reportOperationalError(input: {
  event: string;
  error: unknown;
  scanJobId?: string;
  exportJobId?: string;
}): Promise<void> {
  const endpoint = process.env.RIZPOINT_ERROR_TRACKING_WEBHOOK_URL;
  if (!endpoint) return;
  const message =
    input.error instanceof Error ? input.error.message : "unknown";
  await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      service: "worker",
      event: input.event,
      release: process.env.RIZPOINT_RELEASE_SHA ?? "development",
      message: redactText(message),
      ...(input.scanJobId ? { scanJobId: input.scanJobId } : {}),
      ...(input.exportJobId ? { exportJobId: input.exportJobId } : {}),
    }),
    signal: AbortSignal.timeout(3_000),
  }).then((response) => {
    if (!response.ok) throw new Error("error_tracking_delivery_failed");
  });
}
