# ADR-0007: Upload ingestion and mapping safety

## Status

Accepted

## Context

Supplier catalogs are untrusted and can be large, malformed, or contain identifiers whose leading zeroes are commercially meaningful. The product needs reusable mappings without allowing a heuristic or AI process to silently modify financial or identifier values.

## Decision

- Store uploads privately under a random quarantine key and issue five-minute signed PUT URLs.
- Inspect only CSV, XLS, and XLSX through the scanner service after a fail-closed ClamAV scan.
- Bound archive expansion, sheets, rows, columns, and preview size; do not evaluate formulas or macros.
- Persist the selected sheet/header row and explicit typed mapping before normalization.
- Keep identifiers as strings, validate GS1 check digits as warnings, and return decimal values as strings for PostgreSQL `NUMERIC` persistence.
- Use a unique outbox event for each inspection/normalization stage and replace persisted rows atomically, making worker retries idempotent.

## Consequences

The local stack has an additional ClamAV dependency and upload processing is intentionally not available when it is unhealthy. XLS formatting preservation is best-effort for suppliers that store identifiers as numbers; suppliers should export identifier columns as text whenever possible.
