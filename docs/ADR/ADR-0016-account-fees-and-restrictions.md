# ADR-0016: Account-specific fee and restriction observations

## Status

Accepted — 2026-07-16

## Context

An aggregate Amazon fee total is insufficient for auditable profitability, and
a missing Listings Restrictions payload must not be interpreted as seller
eligibility. Product Fees estimates also apply to the requested price and
fulfillment inputs; they do not define a reusable fee formula.

## Decision

- Use Product Fees v0 `getMyFeesEstimateForASIN` behind `FeeProvider`.
- Persist the aggregate and each returned fee detail as Decimal/NUMERIC, with
  scenario price/source, listing and shipping inputs, fulfillment, completeness,
  provider, operation, marketplace, observed time, expiry, request hash, and a
  private raw-evidence reference.
- Use Listings Restrictions v2021-08-01 `getListingsRestrictions` behind
  `RestrictionProvider` and preserve seven explicit decision states.
- Treat only a successful complete response with an explicitly empty
  restrictions array as `ELIGIBLE`.
- Upgrade deterministic calculation to `profit-engine/v3`. Reconcile complete
  components before calculation. A live point estimate is valid only at its
  quoted price; only an explicit fixture/config model can be evaluated at other
  prices.
- Key fee observations by scenario source and the non-secret request hash so
  exact current, conservative, stress-price, and user-entered estimates can
  coexist without overwriting each other. The calculation worker reuses a
  fresh exact quote or obtains the missing point estimate through `FeeProvider`
  before evaluating that scenario. Concurrent identical requests are
  single-flight and retries reuse the persisted quote.
- Keep raw provider payloads private. Browser DTOs receive normalized evidence,
  hashes, source, timestamps, freshness, fee components, and readable
  restriction reasons.

## Consequences

Profit remains blocked when an exact scenario quote cannot be obtained or is
incomplete, stale, unauthorized, throttled, or currency-inconsistent. This is
preferable to extrapolating an Amazon fee response. Stress quotes use the
`CONSERVATIVE` provider request class plus their exact discounted price; the
profit snapshot continues to label the calculated output as `STRESS`.

## Official references

- [Product Fees API](https://developer-docs.amazon.com/sp-api/lang-en_EN/docs/product-fees-api)
- [Get product fee estimates for an ASIN](https://developer-docs.amazon.com/sp-api/lang-en_EN/docs/get-product-fee-estimates-asin)
- [Listings Restrictions API](https://developer-docs.amazon.com/sp-api/reference/getlistingsrestrictions)
- [Get listings restrictions](https://developer-docs.amazon.com/sp-api/docs/get-listings-restrictions)
