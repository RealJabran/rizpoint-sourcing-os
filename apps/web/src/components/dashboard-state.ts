import type { ScanSummary } from "@/src/scan-summary";

export type { ScanSummary } from "@/src/scan-summary";

export type DashboardSummary = {
  totalScans: number;
  processingScans: number;
  attentionScans: number;
  recentScans: ScanSummary[];
};

export type ProviderConnectionStatus =
  | "NOT_CONFIGURED"
  | "CONFIGURED"
  | "AUTHORIZED"
  | "UNAUTHORIZED"
  | "QUOTA_EXHAUSTED"
  | "THROTTLED"
  | "UNAVAILABLE"
  | "PARTIAL"
  | "HEALTHY";

export function providerStatusPresentation(
  status: ProviderConnectionStatus,
  mode: "MOCK" | "LIVE" = "LIVE",
): {
  label: string;
  tone: "neutral" | "success" | "warning" | "danger";
  detail: string;
} {
  if (mode === "MOCK")
    return {
      label: "Mock",
      tone: "neutral",
      detail:
        "Deterministic fixture data is active; it is not live Amazon data.",
    };
  switch (status) {
    case "HEALTHY":
      return {
        label: "Healthy",
        tone: "success",
        detail: "The live provider connection was validated.",
      };
    case "AUTHORIZED":
      return {
        label: "Authorized",
        tone: "success",
        detail: "Authorization is present; provider health awaits validation.",
      };
    case "NOT_CONFIGURED":
      return {
        label: "Not configured",
        tone: "warning",
        detail: "Live Amazon credentials have not been configured.",
      };
    case "CONFIGURED":
      return {
        label: "Configured",
        tone: "warning",
        detail:
          "Credentials are stored but authorization is not yet confirmed.",
      };
    case "UNAUTHORIZED":
      return {
        label: "Unauthorized",
        tone: "danger",
        detail: "Re-authorize the seller connection before live use.",
      };
    case "THROTTLED":
      return {
        label: "Throttled",
        tone: "warning",
        detail: "Amazon has asked the service to slow down.",
      };
    case "QUOTA_EXHAUSTED":
      return {
        label: "Quota exhausted",
        tone: "warning",
        detail:
          "The current provider budget is exhausted and will recover with its next window.",
      };
    case "PARTIAL":
      return {
        label: "Partial",
        tone: "warning",
        detail: "Only part of the requested provider data is available.",
      };
    case "UNAVAILABLE":
      return {
        label: "Unavailable",
        tone: "danger",
        detail: "Provider status cannot be confirmed right now.",
      };
  }
}

type StatusPresentation = {
  label: string;
  tone: "neutral" | "info" | "success" | "warning" | "danger" | "blocked";
  progress: number;
};

const scanStatuses: Record<string, StatusPresentation> = {
  UPLOADED: { label: "Upload received", tone: "info", progress: 8 },
  MAPPING_REQUIRED: {
    label: "Mapping required",
    tone: "warning",
    progress: 22,
  },
  READY: { label: "Ready to normalize", tone: "warning", progress: 30 },
  NORMALIZING: { label: "Normalizing", tone: "info", progress: 42 },
  MATCHING: { label: "Matching", tone: "info", progress: 58 },
  ENRICHING: { label: "Enriching", tone: "info", progress: 72 },
  CALCULATING: { label: "Calculating", tone: "info", progress: 88 },
  QUEUED: { label: "Queued", tone: "info", progress: 5 },
  RUNNING: { label: "Running", tone: "info", progress: 35 },
  COMPLETED: { label: "Completed", tone: "success", progress: 100 },
  PARTIAL_SUCCESS: { label: "Partial data", tone: "warning", progress: 100 },
  FAILED_RETRYABLE: { label: "Retry required", tone: "warning", progress: 0 },
  FAILED_FINAL: { label: "Failed", tone: "danger", progress: 0 },
};

export function scanStatusPresentation(status: string): StatusPresentation {
  return (
    scanStatuses[status] ?? {
      label: "Unknown status",
      tone: "neutral",
      progress: 0,
    }
  );
}

export function relativeTimestamp(value: string): string {
  const milliseconds = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(milliseconds) || milliseconds < 0)
    return "Updated recently";
  const minutes = Math.floor(milliseconds / 60_000);
  if (minutes < 1) return "Updated just now";
  if (minutes < 60) return `Updated ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Updated ${hours}h ago`;
  return `Updated ${Math.floor(hours / 24)}d ago`;
}

export function scanDisplayName(scan: ScanSummary): string {
  if (scan.upload?.originalFilename) return scan.upload.originalFilename;
  if (scan.jobType === "MOCK") return "Local mock scan";
  return "Catalog scan";
}
