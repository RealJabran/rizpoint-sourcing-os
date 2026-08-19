# Portfolio optimizer

Prompt 26 adds `portfolio-optimizer/v1`, a deterministic Decimal-based integer
allocator. It is separate from both wholesale `profit-engine/v3` and
private-label `private-label-profit/v1`; it consumes their sourced candidate
outputs but never changes or recalculates those source records.

## Objective and quantity model

For every candidate, quantity is either zero or an integer case multiple at or
above `ceil(MOQ / case_pack) × case_pack`. The maximum quantity is the smallest
of:

- the high-demand coverage cap;
- the ASIN cash-exposure cap; and
- the total cash budget.

Coverage days are `target_inventory_days + lead_time_days`; delayed
replenishment adds the configured delay. Expected sales are capped separately
at low and high demand over that coverage window. The exact branch-and-bound
objective is lexicographic: maximize conservative expected profit, then high
expected profit, then product count, then minimize cash used, with a stable
candidate-key tie break. This ordering is visible and versioned; there is no AI
or hidden weighted score.

Brand, category, and ASIN limits are percentages of the full cash budget.
Compliance, seasonality, competition, volatility, confidence, margin, and ROI
policies exclude candidates before search, retaining every reason. The output
records the cash/profit range, allocations, excluded products, concentration,
cash HHI-derived diversification, and an explicit constraint audit.

## Stress modes

The run stores all stress values and solves each scenario independently:

- `BASE`;
- `DEMAND_DOWN_20` (configured demand reduction, default 20%);
- `PRICE_DOWN_10` (configured price reduction, default 10%);
- `FEE_UP_5` (configured per-unit fee increase, default 5%);
- `DELAYED_REPLENISHMENT` (configured delay, default 30 days); and
- `AD_COST_INCREASE` (configured per-unit ad-cost increase, default 20%).

The names remain stable for comparison even when the explicit stored magnitude
is changed by the user.

## Safety and bounds

The exact solver accepts at most 24 candidates, 200 positive quantity options
per candidate, and 500,000 search nodes by default (configurable only within the
hard maximum). If it cannot finish and prove optimality, it returns
`SOLVER_FAILED` and publishes no partial incumbent. Invalid data and a genuinely
empty feasible set remain distinct. Every candidate must be a CatalogProduct in
the selected organization/project and carry dated evidence references.
