# ADR-0012: Shortlist, purchase-order, and safe-export workflow

## Status

Accepted

## Decision

Shortlist and purchase-order records are organization-scoped workflow snapshots. A PO is single-supplier, single-route, and single-scenario. Order quantities are positive integers and are rounded upward from requested sellable units using supplier-owned, timestamped MOQ and case-multiple rules; a PO is blocked if those rules are absent.

Financial projections are copied from the selected current immutable `ProfitResult` scenario; the PO engine only performs Decimal quantity multiplication and aggregation. Validation deterministically rebuilds every line and header total, checks the scenario equation, supplier minimum/budget, match, PackGuard, currency, and freshness before export.

Exports are generated asynchronously through the transactional outbox and worker, stored privately, and downloaded only after an organization-scoped check. Jobs have an expiring running lease and a seven-day artifact expiry. CSV/XLSX output is allowlisted and formula-safe; dangerous leading text is prefixed with an apostrophe while numeric values remain numeric. Audit events retain request fingerprints, before/after transition state, and reconciliation metadata.
