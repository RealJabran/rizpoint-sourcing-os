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
| `Upload` / `UploadSheet`                                   | Private uploaded file metadata, inspection result, rejection code, and exactly one selected sheet/header row.                   | `organization_id`              |
| `ColumnMapping` / `SheetProfile`                           | Explicit scan mapping and reusable, typed supplier mapping profile.                                                             | Through `ScanJob` / `Supplier` |
| `SupplierRow` / `NormalizedOffer` / `NormalizationWarning` | Immutable-source row, normalized catalog fields, and non-silent validation warnings.                                            | Through `ScanJob`              |

`NormalizedOffer` money and dimensions are `NUMERIC(18,4)`; the scanner returns decimal strings, never binary floats. UPC, EAN, GTIN, and ASIN are strings. `NormalizationWarning` records invalid identifiers and numeric values rather than silently discarding them.

## Phase 2 physical schema

| Entity                                 | Purpose                                                                               | Tenant boundary                                   |
| -------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `CatalogProduct` / `ProductIdentifier` | Provider-normalized candidate and typed identifiers with source observation metadata. | Provider global; candidates reference tenant rows |
| `MatchLookup`                          | Scan-scoped, idempotent provider lookup response with provenance and freshness.       | `organization_id`                                 |
| `ListingCandidate` / `MatchEvidence`   | Candidate score and feature-level agreement, contradiction, or unknown evidence.      | `organization_id`                                 |
| `MatchDecision`                        | System or human selection state and reason codes for one supplier row.                | `organization_id`                                 |
| `PackGuardResult`                      | Case/pack verification state and decimal cost per sellable unit.                      | Through `ListingCandidate`                        |

`CatalogProduct.observed_at` and `freshness_state`, together with its provider and provider reference, are mandatory. `MatchLookup` retains the raw provider response used for the decision. `PackGuardResult.cost_per_sellable_unit` is `NUMERIC(18,4)` and is null whenever PackGuard blocks.

## Phase 4 physical schema

| Entity                 | Purpose                                                                                | Tenant boundary   |
| ---------------------- | -------------------------------------------------------------------------------------- | ----------------- |
| `FinancialPolicy`      | Decimal thresholds, currency, stress rule, and engine version.                         | `organization_id` |
| `ShippingRoute`        | Effective-dated per-sellable freight, prep, inbound, storage, return, and other costs. | `organization_id` |
| `BrandPolicy`          | Supplier/brand restriction and approval status.                                        | `organization_id` |
| `ProfitCalculationRun` | Idempotent calculation run bound to a scan and policy.                                 | `organization_id` |
| `ProfitResult`         | Route-specific NUMERIC outputs, evidence/input snapshots, and recommendation.          | `organization_id` |

## Phase 5 physical schema

| Entity                                 | Purpose                                                                 | Tenant boundary         |
| -------------------------------------- | ----------------------------------------------------------------------- | ----------------------- |
| `AnalysisView`                         | Versioned saved filters, sort, route, and visible-column state.         | `organization_id`       |
| `ProfitCostOverride` / values / events | Current typed Decimal assumptions and append-only override audit trail. | `organization_id`       |
| `ProfitCalculationTarget`              | Exact row/route scope of a targeted recalculation.                      | Through calculation run |

`ProfitResult.is_current` is the fast workspace projection; prior calculation records remain historical evidence. Override money is `NUMERIC(18,4)` and no supplier or provider value is overwritten.

## Required external metric fields

Every catalog, price, fee, restriction, or history observation must carry `provider`, `observed_at`, `freshness_state`, and the relevant provider reference. Cached or stale values may be displayed only with their freshness state.

`ProviderObservation` is unique by enrichment item, metric, and provider. A
competitive-pricing observation additionally stores the operation, ASIN,
marketplace, request hash and non-secret inputs, status, completeness, private
raw-evidence reference, featured-offer state and typed price fields, Amazon
Retail presence, total/FBA/FBM visible-offer counts with independent
`COMPLETE`/`PARTIAL`/`UNKNOWN` semantics, and lowest returned FBA/FBM prices.
Price fields use `NUMERIC(18,4)`. Null means unavailable or unknown; it must not
be serialized as zero or false. The private `raw_evidence` JSONB value is
retained for audit; browser DTOs expose only its checksum reference.

## Money and ratios

Financial columns use PostgreSQL `NUMERIC`. Application calculations use Decimal libraries and explicit rounding policies. Binary floats are prohibited. Ratios are represented as Decimal values, not percentages stored as floats.

## Phase 6 workflow entities

`Shortlist`, `ShortlistItem`, `ShortlistNote`, `PurchaseOrder`, `PurchaseOrderLine`, `ExportJob`, and `WorkflowAuditEvent` are organization-scoped. Purchase-order money is `NUMERIC(18,4)` and quantities are positive integers. Supplier ordering rules retain a source and observed timestamp; PO creation blocks without them. Export jobs retain the source revision, checksum, byte size, generator version, private object key, and expiry; raw provider payloads are not exported by default.
