# Matching policy

Matching is a cascade: supplied ASIN, exact GTIN, MPN plus brand, then normalized title search. Candidate scoring records independent evidence for identifiers, brand, model, size, pack/count, variation, and title similarity.

A candidate can be auto-accepted only with a qualifying score and no brand, model, size, or pack contradiction. Any contradiction requires human review. Unknown pack relationships produce `BLOCKED_PACK_UNCERTAIN` for profitability.

Human acceptance requires a reviewer reason and idempotency key and writes a
workflow audit event. A reviewer can record a candidate with a known hard
contradiction for investigation, but that decision remains non-verified for the
profit and purchase-order engines until the contradiction is resolved.

## Phase 2 implementation

The worker executes the cascade in priority order and only advances when the prior
stage returns no candidates: supplied ASIN, exact UPC/EAN/GTIN, explicit MPN plus normalized
brand, then title search. A supplier SKU (`ITEM_NUMBER`) is retained as supplier identity and is never treated as manufacturer model/MPN evidence. Invalid ASIN, UPC, EAN, and GTIN values are never used
for exact lookup. The Phase 2 provider is `MockCatalogProvider`; it is an
explicit test boundary and does not call Amazon or scrape web pages.

Each candidate persists feature-level evidence, score, source, provider response
provenance (`provider`, `observed_at`, and freshness), and a system decision. A
hard contradiction for brand, model, extracted/explicit size, pack count, or
variation always produces `REVIEW_REQUIRED`, even when a supplied ASIN or exact
identifier otherwise scores highly. Near-tied candidates and every strong title
candidate also require review; title search cannot auto-accept.

PackGuard runs for every persisted candidate. Only an explicit case-count mapping
or an unambiguous `12/cs` / `case of 12` supplier phrase establishes units per
case; generic inventory quantity and consumer pack count do not. Missing case,
Amazon pack, or supplier cost is `BLOCKED_PACK_UNCERTAIN`; a non-divisible supplier case is
`BLOCKED_PACK_CONTRADICTION`; only a divisible relationship with a decimal supplier
cost is `VERIFIED`. Profitability consumers must reject both blocked states.
