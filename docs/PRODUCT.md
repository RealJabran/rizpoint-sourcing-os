# Product

RizPoint Sourcing OS helps an Amazon wholesale operator turn supplier catalogs into an auditable purchase-ready shortlist.

## Product principles

- Correctness and explainability take priority over feature count.
- AI may suggest column mappings, candidates, and explanations; it cannot calculate financial outputs.
- Every product decision must expose source evidence, timestamps, assumptions, and unresolved risks.
- A case, pack, or unit contradiction blocks automatic acceptance.

## Phase 1 scope

Phase 1 adds supplier-catalog ingestion through private object storage. It supports CSV, XLSX, and XLS inspection; bounded sheet/header previews; explicit mapping; persisted normalized rows; GS1 check-digit warnings; and a saved VSI mapping profile. Identifiers remain strings throughout ingestion so leading zeroes are preserved.

The proof slice uploads a local file through a short-lived signed URL, runs it through malware scanning and deterministic inspection, persists a selected mapping, then normalizes rows in a checkpointed background job.

## Phase 2 scope

Phase 2 adds deterministic catalog matching after normalization. It cascades from supplied ASIN to exact UPC/EAN/GTIN, MPN plus brand, and title candidates. Candidates retain feature-level evidence, confidence, provider provenance, and freshness. Brand, model, size, pack, or variation contradictions cannot auto-accept. PackGuard prevents downstream profitability when case-to-sellable pack data is unknown or contradictory.

## Phase 4 scope

Phase 4 adds an idempotent, tenant-scoped calculation stage after enrichment. A configured financial policy, dated shipping route, verified PackGuard result, and fresh price, fee, history, and restriction evidence are required. It stores Decimal/NUMERIC scenario outputs and evidence snapshots. Missing or unsupported fee evidence remains explicit `PARTIAL_SUCCESS`; it never becomes an optimistic profit estimate.

## Future workflow

`upload → inspect/map → normalize → match → enrich → calculate → review → shortlist → purchase order`

The canonical scan state machine is documented in [Architecture](ARCHITECTURE.md).
