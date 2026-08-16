# ADR-0020: Versioned descriptive analytics from normalized history

## Context

Licensed history is sparse, provider-specific evidence. Price, rank, offer,
availability, and review observations are useful only when their coverage and
window are visible. Filling gaps, treating rank as sales, or mixing raw facts
with derived scores would make research misleading.

## Decision

Create `@rizpoint/history-analytics` as a pure Decimal-based engine. It accepts
only one provider's normalized product series and returns versioned descriptive
30/90/180/365-day metrics, coverage/confidence, and warnings. The worker writes
an idempotent `HistoryAnalyticsAssessment` keyed by organization, product,
marketplace, provider, engine version, and source-point fingerprint.

The product evidence drawer exposes a separate History tab: raw observations
retain provider timestamps and freshness, while derived metrics retain their
calculation window, version, and input references. No historical metric changes
the wholesale calculation or claims sales from BSR.

## Consequences

Sparse evidence remains `INSUFFICIENT_DATA` or `PARTIAL`; absent dates are not
zero-filled. A future scoring policy may consume an assessment only by naming
the calculation version and input snapshot. Provider changes create a separate
assessment rather than blending vendors.
