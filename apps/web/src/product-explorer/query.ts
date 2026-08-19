import type { Filters } from "./types";

export function explorerQuery(filters: Filters, offset = 0) {
  const params = new URLSearchParams({ offset: String(offset), limit: "50" });
  Object.entries(filters).forEach(([key, value]) => {
    if (value) params.set(key, value);
  });
  return params;
}

export function explorerDataState(freshness: string | null, value: unknown) {
  if (value === null || value === undefined) return "MISSING" as const;
  if (freshness === "STALE") return "STALE" as const;
  if (freshness === "PARTIAL") return "PARTIAL" as const;
  return "CURRENT" as const;
}
