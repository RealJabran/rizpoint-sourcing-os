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

## Phase 7.6 Catalog Items identity observation

With `PROVIDER_MODE=sp_api`, the worker uses Catalog Items v2022-04-01 through
`CatalogProvider`: validated supplied ASIN, then UPC/EAN/GTIN (kept as strings,
including leading zeroes), then brand-qualified part/title candidates. Exact
identifier requests are bounded to 20 values of one type. The typed projection
records title, identifiers, maker/model, size/color/count, product type, ranks,
image links, variation/package relationships, marketplace, observed time,
freshness, request lineage, and response completeness. The raw provider response
is retained only in private catalog persistence and is never a web DTO. Images
are hotlinked with `no-referrer`; they are not copied to RizPoint storage.

Physical dimensions retain a value and unit for each measurement independently
(for example, package length in `IN` and package weight in `LB`). A relationship
variation theme is retained when Catalog Items returns it, even if that theme is
not repeated in the general attributes payload.

Provider throttling, authorization failure, and partial observations remain
explicit states. A title search never auto-accepts; brand/model/size/count/pack
or package-hierarchy contradictions require review and PackGuard remains blocked.
