# ADR-0015: Amazon offers are typed, partial observations

## Decision

The SP-API pricing adapter implements Product Pricing v2022-05-01
`getCompetitiveSummary` behind `PricingProvider`. It batches at most 20 unique
ASINs for one marketplace and requests featured buying options plus New/Consumer
lowest-priced offers. Monetary values cross the boundary as decimal strings and
persist as PostgreSQL `NUMERIC`.

Featured-offer state, Amazon Retail presence, and each visible-offer count have
explicit present/absent/unknown or complete/partial/unknown semantics. Returned
lowest-priced offers are not treated as a complete seller population. AFN/FBA
means Amazon fulfillment, not Amazon Retail. Amazon Retail can be `PRESENT` only
when a tested marketplace policy verifies a returned seller identifier;
incomplete evidence remains `UNKNOWN`. Brand ownership is never inferred.

One current observation is retained per enrichment item, metric, and provider.
The record carries provider, operation, ASIN, marketplace, observation and
expiry times, request hash and non-secret inputs, completeness, explicit failure
status, private raw evidence, and its checksum reference. Fresh successful/partial records
are reused during retries; stale records refresh; older retries cannot replace a
newer observation. The analysis API exposes only the typed projection through
an organization-scoped query.

## Consequences

Mock mode remains deterministic and credential-free. Read-only provider calls
may safely repeat only for uncheckpointed items after a process crash; persisted
items and duplicate ASIN rows do not cause duplicate calls within a run. A 429
or transient outage schedules a bounded retry and persists unknown fields rather
than false zeros. Raw provider payloads and credentials never enter browser
DTOs.

Official contracts:

- [Product Pricing API](https://developer-docs.amazon.com/sp-api/docs/product-pricing-api)
- [getCompetitiveSummary](https://developer-docs.amazon.com/sp-api/reference/getcompetitivesummary)
- [Amazon SP-API models](https://github.com/amzn/selling-partner-api-models/blob/main/models/product-pricing-api-model/productPricing_2022-05-01.json)
