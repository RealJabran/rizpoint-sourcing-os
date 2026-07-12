# Product

RizPoint Sourcing OS helps an Amazon wholesale operator turn supplier catalogs into an auditable purchase-ready shortlist.

## Product principles

- Correctness and explainability take priority over feature count.
- AI may suggest column mappings, candidates, and explanations; it cannot calculate financial outputs.
- Every product decision must expose source evidence, timestamps, assumptions, and unresolved risks.
- A case, pack, or unit contradiction blocks automatic acceptance.

## Phase 0 scope

Phase 0 establishes repository boundaries, durable job execution, and local infrastructure. It deliberately excludes supplier-file ingestion, matching, provider credentials, Amazon calls, profit calculations, shortlists, purchase orders, billing, and multi-tenant UI.

The proof slice creates a synthetic scan for a seeded organization, sends it through a durable queue and mock scanner, and displays its persisted completion state.

## Future workflow

`upload → inspect/map → normalize → match → enrich → calculate → review → shortlist → purchase order`

The canonical scan state machine is documented in [Architecture](ARCHITECTURE.md).
