# Profit engine policy

`profit-engine/v3` is the deterministic Phase 7.6 calculation boundary. It accepts decimal strings only and uses `decimal.js` with precision 40 and `HALF_UP` rounding. PostgreSQL stores money as `NUMERIC(18,4)` and ratios as `NUMERIC(12,4)`.

For one sellable Amazon unit:

```text
effective_cogs = verified_packguard_cost_per_sellable_unit
  + allocated_supplier_freight + prep_fee + labeling_fee + polybag_fee
  + bundle_fee + bubblewrap_fee + inbound_shipping + duty_or_tax
  + storage_allowance + return_allowance + other_costs

amazon_fees(price) = reconciled complete provider fee components at the quoted price
  OR max(minimum_fee, fixed_fee + percentage_of_price × price)
     only for an explicitly configured deterministic fixture model
net_profit = modeled_selling_price - effective_cogs - amazon_fees(modeled_selling_price)
roi_percent = net_profit / effective_cogs × 100
margin_percent = net_profit / modeled_selling_price × 100
break_even_price = solve(price - effective_cogs - amazon_fees(price) = 0)
```

Displayed money and ratios use `HALF_UP` to two decimals. Snapshots retain four-decimal inputs and intermediates. Break-even rounds **up** to the next cent so the displayed value cannot create a loss under the modeled fee function.

## Required evidence

Each result retains PackGuard, selected route/effective date, policy version, raw Decimal costs, and provider, observed time, freshness expiry, currency, quoted price, component details, completeness, fulfillment input, request lineage, and scenario source. Current featured-offer, conservative historical-minimum, stress, optional MAP, and optional user-entered scenarios are retained with decision reasons and failed rules. A user-entered price is labeled as such and is not a prediction or guarantee.

A fee quote must be complete, fresh, currency-consistent, and reconcile its top-level component final fees to its aggregate total. A live point estimate can calculate only the exact requested scenario price; it is never extrapolated to another price. Consequently, break-even is omitted for a point estimate unless an explicit deterministic fee function is available. Opaque or partial totals remain enrichment evidence but cannot produce a calculated scenario. Missing route, currency, freshness, history, PackGuard, fee evidence, or seller eligibility becomes explicit `PARTIAL_SUCCESS`.

Before calculation, the worker looks up a fresh fee observation matching the
scenario source, exact Decimal price, currency, fulfillment input, marketplace,
and ASIN. When live provider mode is configured, a missing current,
conservative, stress-price, or user-entered quote is requested and persisted
through the typed fee boundary. Identical concurrent requests are single-flight,
and retries reuse the persisted request-keyed observation. Provider failures
remain typed evidence; they never trigger fee extrapolation or a successful
recommendation.

## Recommendation policy

`BUY` requires verified match/pack, explicit `ELIGIBLE` seller status, resolved non-prohibited brand policy, complete fresh financial evidence, demand evidence, passing conservative thresholds, and an acceptable stress result. Hard seller restrictions and prohibited brands return `AVOID` before approval checks. Approval-required status routes to review; incomplete, unauthorized, throttled, and unknown eligibility cannot yield `BUY`. Invalid thresholds, costs, fee components/models, scenario prices, or discounts cannot yield `BUY`.

AI may explain evidence but never supplies financial values or executes these formulas.

## Private-label quote scenarios

`private-label-profit/v1` is an additive engine and does not call or modify the
wholesale `profit-engine/v3` path. Its complete cost register distinguishes
`PER_UNIT`, `BATCH_TOTAL`, and `PERCENT_OF_PRICE` assumptions. Every category is
required, including explicit zeroes; `UNKNOWN` amounts block calculation, while
`ESTIMATED` amounts remain visible in the output.

For an MOQ-sized initial order:

```text
converted_unit_cost = supplier_unit_cost × observed_fx_rate (only when currencies differ)
batch_cost_per_unit = batch_total / MOQ
percentage_cost_per_unit = target_price × percentage / 100
landed_cost_per_unit = converted_unit_cost + packaging + labeling + inspection
  + freight + customs/tariffs + insurance + prep + inbound shipping
contribution_margin_per_unit = target_price - landed_cost - operating costs
net_profit_per_unit = contribution_margin - allocated samples/tooling/setup
ROI = net_profit / (landed_cost + allocated one-time costs) × 100
margin = net_profit / target_price × 100
break_even_price = fixed_cost_per_unit / (1 - total percentage cost rate)
break_even_ad_spend = current_ad_allocation + net_profit
initial_cash = MOQ procurement/landed costs + one-time costs + launch ad budget
MOQ_cash_exposure = MOQ × landed_cost_per_unit
```

The engine returns four-decimal exact money/ratio strings; display layers may
round money to cents. A break-even value is omitted with a reason when its
denominator is not mathematically valid or no nonnegative ad-spend threshold
exists. Currency conversion requires source, observation time, direction, and
Decimal rate. Named stress results modify price and costs without mutating the
base scenario.
