# Profit engine policy

No production profit calculation is implemented in Phase 0. This document establishes the non-negotiable boundary for Phase 4.

For a sellable Amazon unit:

```text
effective_cogs = supplier_unit_cost × amazon_pack_count
  + allocated_supplier_freight + prep_fee + packaging
  + inbound_to_amazon + duty_or_tax + storage_allowance
  + expected_return_allowance + configured_other_costs

amazon_fees = referral_fee + fba_fulfillment_fee + other_fee_estimates
net_profit = modeled_selling_price - effective_cogs - amazon_fees
roi_percent = net_profit / effective_cogs × 100
margin_percent = net_profit / modeled_selling_price × 100
```

All inputs, intermediate values, outputs, engine version, rounding method, provider source, and overrides must be retained. A formula engine must not execute when PackGuard reports an unknown or contradictory pack relationship.

AI is never a financial-calculation authority.
