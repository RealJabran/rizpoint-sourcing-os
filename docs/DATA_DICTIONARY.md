# Data dictionary

## Phase 1 physical schema

| Entity                                                     | Purpose                                                                                                                         | Tenant boundary                |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| `Organization`                                             | Logical owner of all business data.                                                                                             | Root tenant                    |
| `ScanJob`                                                  | Canonical job state and mock result.                                                                                            | `organization_id`              |
| `ScanCheckpoint`                                           | Idempotent stage checkpoint for a job.                                                                                          | Through `ScanJob`              |
| `ScanEvent`                                                | Append-only state/audit event.                                                                                                  | Through `ScanJob`              |
| `OutboxEvent`                                              | Durable instruction to enqueue work after commit; carries a claim token, claim lease, delivery count, and safe last-error code. | `organization_id`              |
| `Supplier`                                                 | Organization-scoped supplier, including the local VSI preset.                                                                   | `organization_id`              |
| `Upload` / `UploadSheet`                                   | Private uploaded file metadata, inspection result, and selected sheet/header row.                                               | `organization_id`              |
| `ColumnMapping` / `SheetProfile`                           | Explicit scan mapping and reusable supplier mapping profile.                                                                    | Through `ScanJob` / `Supplier` |
| `SupplierRow` / `NormalizedOffer` / `NormalizationWarning` | Immutable-source row, normalized catalog fields, and non-silent validation warnings.                                            | Through `ScanJob`              |

`NormalizedOffer` money and dimensions are `NUMERIC(18,4)`; the scanner returns decimal strings, never binary floats. UPC, EAN, GTIN, and ASIN are strings. `NormalizationWarning` records invalid identifiers and numeric values rather than silently discarding them.

## Required future external metric fields

Every catalog, price, fee, restriction, or history observation must carry `provider`, `observed_at`, `freshness_state`, and the relevant provider reference. Cached or stale values may be displayed only with their freshness state.

## Money and ratios

Financial columns use PostgreSQL `NUMERIC`. Application calculations use Decimal libraries and explicit rounding policies. Binary floats are prohibited. Ratios are represented as Decimal values, not percentages stored as floats.

## Future conceptual entities

Listing candidates, provider snapshots, cost scenarios, profit results, shortlists, purchase orders, and audit entities remain planned.
