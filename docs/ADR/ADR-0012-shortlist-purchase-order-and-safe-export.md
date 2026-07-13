# ADR-0012: Shortlist, purchase-order, and safe-export workflow

## Status

Accepted

## Decision

Shortlist and purchase-order records are organization-scoped workflow snapshots. A PO is single-supplier, single-route, and single-scenario. Order quantities are positive integers and are rounded upward from requested sellable units to verified supplier case packs, MOQ cases, and case-order multiples.

Financial projections are copied from the selected immutable `ProfitResult` scenario; the PO engine only performs Decimal quantity multiplication and aggregation. A PO cannot be validated or exported until its scenario, match, PackGuard, and freshness evidence are complete.

Exports are generated asynchronously through the transactional outbox and worker, stored privately, and downloaded only after an organization-scoped check. CSV/XLSX output is allowlisted and formula-safe; dangerous leading text is prefixed with an apostrophe while numeric values remain numeric.
