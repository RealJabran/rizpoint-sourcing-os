# Matching policy

Matching is a cascade: supplied ASIN, exact GTIN, MPN plus brand, then normalized title search. Candidate scoring records independent evidence for identifiers, brand, model, size, pack/count, variation, and title similarity.

A candidate can be auto-accepted only with a qualifying score and no brand, model, size, or pack contradiction. Any contradiction requires human review. Unknown pack relationships produce `BLOCKED_PACK_UNCERTAIN` for profitability.

## Phase 2 implementation

The worker executes the cascade in priority order and only advances when the prior
stage returns no candidates: supplied ASIN, exact UPC/EAN/GTIN, MPN plus normalized
brand, then title search. The Phase 2 provider is `MockCatalogProvider`; it is an
explicit test boundary and does not call Amazon or scrape web pages.

Each candidate persists feature-level evidence, score, source, provider response
provenance (`provider`, `observed_at`, and freshness), and a system decision. A
hard contradiction for brand, model, extracted/explicit size, pack count, or
variation always produces `REVIEW_REQUIRED`, even when a supplied ASIN or exact
identifier otherwise scores highly. Human review is explicit and tenant-scoped.

PackGuard runs for every persisted candidate. Missing case/quantity, Amazon pack,
or supplier cost is `BLOCKED_PACK_UNCERTAIN`; a non-divisible supplier case is
`BLOCKED_PACK_CONTRADICTION`; only a divisible relationship with a decimal supplier
cost is `VERIFIED`. Profitability consumers must reject both blocked states.
