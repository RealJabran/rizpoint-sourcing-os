export type ExportDownloadState = "READY" | "EXPIRED" | "UNAVAILABLE";

type ExportDownloadCandidate = {
  status: string;
  objectKey: string | null;
  filename: string | null;
  expiresAt: Date | string | null;
};

/**
 * A signed URL is minted only for an unexpired private artifact. Missing expiry
 * fails closed so a retention/configuration error cannot create a permanent link.
 */
export function exportDownloadState(
  job: ExportDownloadCandidate,
  now = new Date(),
): ExportDownloadState {
  if (job.status !== "COMPLETED" || !job.objectKey || !job.filename)
    return "UNAVAILABLE";
  if (!job.expiresAt || new Date(job.expiresAt).getTime() <= now.getTime())
    return "EXPIRED";
  return "READY";
}
