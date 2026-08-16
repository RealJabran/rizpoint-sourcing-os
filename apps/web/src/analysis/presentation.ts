import type { DecimalValue, ExternalEvidence } from "./workspace-types";

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
  return `${evidence.provider} · ${evidence.observedAt.replace("T", " ").slice(0, 19)} · ${humanizeAnalysisValue(effectiveFreshness)}`;
}
