# Profit engine policy

`profit-engine/v2` is the deterministic Phase 4 calculation boundary. It accepts decimal strings only and uses `decimal.js` with precision 40 and `HALF_UP` rounding. PostgreSQL stores money as `NUMERIC(18,4)` and ratios as `NUMERIC(12,4)`.

For one sellable Amazon unit:

```text
effective_cogs = verified_packguard_cost_per_sellable_unit
  + allocated_supplier_freight + prep_fee + labeling_fee + polybag_fee
  + bundle_fee + bubblewrap_fee + inbound_shipping + duty_or_tax
  + storage_allowance + return_allowance + other_costs

amazon_fees(price) = max(minimum_fee, fixed_fee + percentage_of_price × price)
net_profit = modeled_selling_price - effective_cogs - amazon_fees(modeled_selling_price)
roi_percent = net_profit / effective_cogs × 100
margin_percent = net_profit / modeled_selling_price × 100
break_even_price = solve(price - effective_cogs - amazon_fees(price) = 0)
```

Displayed money and ratios use `HALF_UP` to two decimals. Snapshots retain four-decimal inputs and intermediates. Break-even rounds **up** to the next cent so the displayed value cannot create a loss under the modeled fee function.

## Required evidence

Each result retains PackGuard, selected route/effective date, policy version, raw Decimal costs, and provider, observed time, freshness expiry, currency, quoted price, and fee model. Current, conservative historical-minimum, stress, and optional MAP scenarios are retained with decision reasons and failed rules.

A fee quote must reconcile with its quoted price and deterministic fee model. Opaque provider fee totals remain enrichment evidence but cannot produce a calculated scenario. Missing route, currency, freshness, history, PackGuard, or fee evidence becomes explicit `PARTIAL_SUCCESS`.

## Recommendation policy

`BUY` requires verified match/pack, allowed seller eligibility, resolved non-prohibited brand policy, complete fresh financial evidence, demand evidence, passing conservative thresholds, and an acceptable stress result. Hard seller restrictions and prohibited brands return `AVOID` before approval checks. Invalid thresholds, costs, fee models, or scenario discounts cannot yield `BUY`.

AI may explain evidence but never supplies financial values or executes these formulas.
