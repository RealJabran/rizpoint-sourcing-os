import type { DecimalValue, ExternalEvidence } from "./workspace-types";
import { evidenceOrigin } from "../components/evidence-origin";

export function formatDecimal(value: DecimalValue | null): string {
  return value?.toString() ?? "—";
}

export function humanizeAnalysisValue(
  value: string | null | undefined,
): string {
  if (!value) return "Not available";
  return value
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/^./, (letter) => letter.toUpperCase());
}

export function formatEvidenceSource(evidence: ExternalEvidence): string {
  if (!evidence) return "Source not available";
  const effectiveFreshness =
    Date.parse(evidence.freshUntil) < Date.now()
      ? "STALE"
      : evidence.freshnessState;
  return `${evidenceOrigin(evidence.provider)} · ${evidence.provider} · ${evidence.marketplaceId} · ${evidence.observedAt.replace("T", " ").slice(0, 19)} · ${humanizeAnalysisValue(effectiveFreshness)} · ${humanizeAnalysisValue(evidence.completeness)}`;
}
