# Data dictionary

## Provider runtime truth layer

| Entity                                     | Purpose and invariants                                                                                                                                                                                       |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ProviderCredential`                       | Tenant/provider/name-scoped encrypted envelope. The repository accepts ciphertext, nonce, tag, and key version only; browser DTOs never select these fields.                                                 |
| `ProviderEntitlement`                      | Capability discovery state for one organization, provider key, marketplace, and capability. Stores explicit mock/live mode, checked/expiry/retry times, completeness, and a safe reason code.                |
| `ProviderRateBudget`                       | NUMERIC request/credit/token capacity for a bounded time window. Capacity, reserved, consumed, and optional unit cost are nonnegative and cannot over-allocate.                                              |
| `ProviderBudgetReservation`                | Idempotent request-key reservation that becomes consumed, released, or expired. Repeat reservation/settlement does not double charge.                                                                        |
| `ProviderCacheEntry`                       | Tenant/provider/marketplace/capability/operation/request-hash cache identity with observation, fresh, stale, and retention deadlines. Older retries cannot replace newer entries.                            |
| `ProviderRequestLease`                     | Short-lived hashed-owner lease for concurrent provider-call deduplication. Raw owner tokens are not stored.                                                                                                  |
| `ProviderRequestAttempt`                   | Payload-free telemetry: sanitized request hash, provider/capability/operation, explicit origin/state, attempt, timing, retry, provider request ID, cache outcome, and optional NUMERIC credit/cost estimate. |
| `HistoryRefreshRun` / `HistoryRefreshItem` | Optional scan-owned, idempotent history checkpoint. Each item references an accepted ASIN and may cite a tenant-scoped `ResearchObservation`; it cannot change wholesale scan completion.                    |

Provider operational states are `NOT_CONFIGURED`, `CONFIGURED`, `AUTHORIZED`,
`UNAUTHORIZED`, `QUOTA_EXHAUSTED`, `THROTTLED`, `UNAVAILABLE`, `PARTIAL`, and
`HEALTHY`. Unknown or failed metrics remain null/absent in typed observations;
these states never imply numeric zero.

Keepa-normalized product history uses metric keys `AMAZON_PRICE`,
`NEW_OFFER_PRICE`, `SALES_RANK`, `OFFER_COUNT`, `AMAZON_RETAIL_PRESENT`,
`RATING`, `REVIEW_COUNT`, `PRODUCT_FIRST_OBSERVED_AT`, and `CATEGORY_CONTEXT`
only when returned. A point contains exactly one DECIMAL, BIGINT, Boolean, or
text value. Raw evidence is a private, retention-bounded object reference.

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

`ProviderObservation` stores the typed fee scenario source, quoted scenario
price, fulfillment input, completeness, request hash, operation, marketplace,
observation status, private raw-evidence reference, and an `observation_key`.
The key is `PRIMARY` for ordinary metrics and scenario/request-specific for fee
point estimates, allowing exact quotes at different prices to coexist without
weakening the item/metric/provider idempotency boundary. `ProviderFeeComponent`
stores each returned fee type, parent fee type when nested, currency, fee amount,
promotion, tax, and final fee as `NUMERIC(18,4)`. Components are replaced in the
same transaction as a newer observation, so a retry cannot leave a mixed quote.

Listing restrictions use `ListingRestrictionState`: `ELIGIBLE`, `RESTRICTED`,
`APPROVAL_REQUIRED`, `INCOMPLETE`, `UNAUTHORIZED`, `THROTTLED`, or `UNKNOWN`.
Reason codes and readable provider reasons are retained separately. Missing or
malformed response collections are never equivalent to an empty, complete
restriction list.

`ProviderObservation` is unique by enrichment item, metric, provider, and
observation key. A
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

Private-label finance adds `PrivateLabelQuoteScenario`,
`PrivateLabelCostAssumption`, and `PrivateLabelScenarioResult`. Quote and cost
money uses `NUMERIC(18,4)`, FX uses `NUMERIC(20,10)`, aggregate cash uses
`NUMERIC(20,4)`, and ratios use `NUMERIC(12,4)`. Each scenario belongs to one
organization-scoped private-label ResearchProject; cost rows retain allocation,
currency, source, date, and confidence, while immutable base/stress results
retain the complete input snapshot and formula version.

## Research foundation entities

| Entity                                                | Purpose                                                                                                                                                                | Tenant/time boundary                                                      |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `ResearchProject` / `ResearchProjectItem`             | Private-label, wholesale, or manual-ASIN research container and typed product/market/keyword/category/brand/seller subjects. Product items reference `CatalogProduct`. | `organization_id`; project marketplace                                    |
| `ResearchTag` / `ResearchProjectTag` / `ResearchNote` | Organization-owned labels and evidence-linked notes.                                                                                                                   | Composite tenant foreign keys                                             |
| `ProductWatch`                                        | Marketplace-specific watch cadence for an existing catalog product.                                                                                                    | Unique organization + marketplace + product                               |
| `MarketDefinition` / `MarketMember`                   | Versioned frozen or dynamic universe and time-bounded product membership.                                                                                              | `organization_id`, marketplace, joined/left time                          |
| `Keyword`                                             | Original phrase plus normalized identity and locale.                                                                                                                   | Unique organization + marketplace + locale + normalized phrase            |
| `ResearchObservation`                                 | Common external-evidence envelope.                                                                                                                                     | Organization + marketplace + provider + operation + observed/expiry time  |
| Typed research observations                           | Queryable keyword, product-keyword, product-market, market, category, brand, and seller facts.                                                                         | Composite foreign key to the tenant observation envelope                  |
| `HistoricalMetricSeries` / `HistoricalMetricPoint`    | Sparse, typed history whose points cite the retrieval observation.                                                                                                     | Organization + marketplace + subject + metric + provider; point timestamp |
| `HistoryAnalyticsAssessment`                          | Versioned deterministic descriptive metrics, coverage, warnings, and input point references.                                                                           | Organization + product + marketplace + provider + calculation time        |
| `OpportunityAssessment` / `OpportunityReason`         | Immutable derived recommendation and decomposed evidence-bearing reasons.                                                                                              | `organization_id`, project, marketplace, `calculated_at`                  |
| `AlertRule` / `AlertEvent`                            | Monitoring and deduplicated event foundations; scheduling/evaluation comes later.                                                                                      | `organization_id`, marketplace, observation references                    |

`ResearchObservation` requires provider key, operation, marketplace,
`observed_at`, freshness, completeness, provider status, an idempotent observation
key, and optional sanitized request hash/inputs and private raw-evidence reference.
Its typed projection never reads business truth from raw JSON. Scan-bound
`ProviderObservation` remains unchanged for wholesale enrichment.

History values are mutually exclusive `NUMERIC(30,10)`, `BIGINT`, Boolean, or
text columns. Money and money-derived ratios use the decimal column; identifier
values remain strings. Points are append-only per series, source observation,
and metric timestamp. The default retention is 730 days, with a btree on
organization/series/time and a BRIN index on time. Provider license/rights may
shorten retention. Partitioning is deferred until measured volume justifies it.

Opportunity scores and reason weights are `NUMERIC(12,4)`. Every assessment
stores `calculation_version`, `input_observation_references`, and
`calculated_at`. Assessments are separate rows and cannot overwrite provider
observations. `INSUFFICIENT_DATA` may deliberately have no input observation;
all other assessment states require repository-validated inputs.

`HistoryAnalyticsAssessment` stores a JSON projection only after the pure
history engine has calculated it from typed points. It retains its calculation
version, input fingerprint, exact point references, calculated time, bounded
window, Decimal coverage percentage, and warnings. It is provider-scoped and
cannot overwrite the raw history that produced it; null/insufficient outputs
mean coverage was not adequate, never that a missing month had a zero value.

## Product Explorer query boundary

Product Explorer is a read projection, not a new product truth table. Its
universe is the union of `ListingCandidate` imported matches,
`ResearchProjectItem` products, active `ProductWatch` records, active
`MarketMember` records, and `HistoryRefreshItem` products for one organization.
The query exposes only typed catalog fields, latest typed pricing observation,
latest review/rank history points, and the latest versioned history assessment.
Each result retains the universe-source labels. Explorer saved views are
`AnalysisView` records with null `scan_job_id` and schema version 1; their query
state is Explorer-specific and cannot be interpreted as scan analysis state.

## Category Intelligence derived projection

Category Intelligence creates no new product or market-size fact table. Its
category key is the first observed `CatalogProduct.identity_projection`
`productTypes` value, with a visible uncategorized label when unavailable. The
projection’s member universe is the same tenant-owned union as Product
Explorer. Its browser counts and detail aggregate metadata record the query
generation time, exact matching product count, and deterministic analysis
window count. Medians, brand HHI, and percentages are Decimal-derived and use
only rows that carry the named observation. `MarketDefinition.definition.kind`
may be `CATEGORY_TRACKED_UNIVERSE`; this is a saved dynamic watch definition,
not provider evidence or a global category census.

## Sales estimation entities

`SalesEstimationModel` is an organization-, marketplace-, and category-scoped
registry entry. Validation requires an external reference dataset ID/source,
positive sample size, versioned parameters, and evaluation metrics.
`SalesEstimate` is an immutable provider or calibrated-model monthly-unit range
using NUMERIC values; it records confidence, source/model version, fingerprint,
evidence references, and observation time. A missing central estimate or
confidence means it was not supplied, never zero demand.

## Phase 6 workflow entities

`Shortlist`, `ShortlistItem`, `ShortlistNote`, `PurchaseOrder`, `PurchaseOrderLine`, `ExportJob`, and `WorkflowAuditEvent` are organization-scoped. Purchase-order money is `NUMERIC(18,4)` and quantities are positive integers. Supplier ordering rules retain a source and observed timestamp; PO creation blocks without them. Export jobs retain the source revision, checksum, byte size, generator version, private object key, and expiry; raw provider payloads are not exported by default.
