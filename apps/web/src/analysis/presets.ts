export const LOW_VISIBLE_COMPETITION_MAX = 3;

export const LOW_VISIBLE_COMPETITION_LABEL = `≤${LOW_VISIBLE_COMPETITION_MAX} visible sellers (configured threshold)`;

export const ANALYSIS_PRESETS = [
  {
    id: "profitable-eligible",
    label: "Profitable & eligible",
    state: {
      recommendation: "BUY",
      restrictionState: "ELIGIBLE",
      status: "COMPLETED",
    },
  },
  {
    id: "no-featured-offer",
    label: "No featured offer",
    state: { featuredOfferState: "ABSENT" },
  },
  {
    id: "amazon-absent",
    label: "Amazon Retail absent",
    state: { amazonRetailPresence: "ABSENT" },
  },
  {
    id: "low-competition",
    label: "Low visible competition",
    state: { maxVisibleOfferCount: String(LOW_VISIBLE_COMPETITION_MAX) },
  },
  {
    id: "fba-competition",
    label: "FBA competition",
    state: { minFbaOfferCount: "1" },
  },
  {
    id: "partial-stale",
    label: "Missing, partial, or stale",
    state: { partialData: true },
  },
  {
    id: "pack-review",
    label: "PackGuard or match review",
    state: { matchStatus: "REVIEW_REQUIRED" },
  },
] as const;
