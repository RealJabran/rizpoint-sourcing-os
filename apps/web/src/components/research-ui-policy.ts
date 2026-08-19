export type DataState =
  "CURRENT" | "STALE" | "PARTIAL" | "UNSUPPORTED" | "MISSING";

export const statePresentation: Record<
  DataState,
  {
    symbol: string;
    label: string;
    tone: "success" | "warning" | "neutral" | "danger";
  }
> = {
  CURRENT: { symbol: "✓", label: "Current", tone: "success" },
  STALE: { symbol: "△", label: "Stale", tone: "warning" },
  PARTIAL: { symbol: "◐", label: "Partial", tone: "warning" },
  UNSUPPORTED: { symbol: "—", label: "Unsupported", tone: "neutral" },
  MISSING: { symbol: "?", label: "Missing", tone: "danger" },
};

export function metricContext(input: {
  source: string | null | undefined;
  window: string | null | undefined;
  observedAt: string | null | undefined;
}) {
  return [
    input.source,
    input.window,
    input.observedAt ? `Observed ${input.observedAt}` : null,
  ].filter((value): value is string => Boolean(value));
}
