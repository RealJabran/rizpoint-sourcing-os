# Next-level Amazon research roadmap

Status: Prompt 00 architecture and product audit  
Audit date: 2026-08-16  
Repository baseline: f1aee15 on main  
Scope: documentation and planning only; no runtime, schema, migration, or configuration changes

## Executive decision

RizPoint should expand as two first-class bounded contexts on one evidence-first platform:

1. **Wholesale Sourcing** remains the proven workflow: supplier catalog → mapping → normalization → matching → PackGuard → authorized Amazon evidence → deterministic profit → analysis → shortlist → purchase order → private export.
2. **Amazon Market Research / Private Label** becomes a new workflow: research universe → product/category/keyword evidence → deterministic historical and opportunity metrics → project/decision record → supplier economics/compliance → launch and monitoring.

The research platform must reuse the existing catalog identity, provider contracts, provenance rules, transactional outbox, tenant scoping, object storage, safe exports, and deterministic calculation patterns. It must not manufacture research work by creating synthetic supplier rows, and it must not turn the existing scan pipeline or analysis screen into universal catch-all modules.

No Amazon HTML scraping is proposed. Broad competitor, history, keyword, rank, review, and market-universe data requires an authorized first-party source, a licensed third-party provider, user-imported authorized data, or a clearly labeled deterministic derivation from those sources.

## Audit basis

This roadmap was reconciled against the actual repository, including:

- AGENTS.md, README.md, PRODUCT, MASTER_BLUEPRINT, ARCHITECTURE, DATA_DICTIONARY, domain documents, and ADRs;
- the full Prisma schema and additive migrations through the analysis-view export and foreign-key-index hardening migrations;
- provider contracts, mock providers, the SP-API adapter, credential vault, worker provider selection, and normalized observations;
- BullMQ, the transactional outbox, checkpoints, retry state, object storage, scanner, matching, PackGuard, profit, ordering, and export engines;
- Next.js routes, the upload flow, analysis query/DTO, saved views, evidence drawer, authentication proxy, and local-demo boundary;
- unit, property, integration, scale, browser, scanner, production-configuration, and CI definitions.

Prompt 00 did not validate live SP-API credentials or provider data quality. Existing live smoke coverage is intentionally opt-in.

## Actual current baseline

| Area                     | Implemented repository surface                                                                                                                 | Strength to preserve                                                                        | Expansion limit                                                                                                                         |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Catalog ingestion        | Next.js upload wizard, private signed object storage, FastAPI/Polars scanner, CSV/XLS/XLSX validation, ClamAV, mapping profiles, normalization | Safe file boundary, leading-zero identifiers, resumable stages                              | Supplier-file-centric; not a research-universe ingest model                                                                             |
| Matching                 | matching-engine package, worker cascade, CatalogProduct, candidates/evidence/decisions, PackGuard                                              | Deterministic evidence and hard contradiction gates                                         | Candidate and decision records require a supplier row                                                                                   |
| Amazon providers         | provider-contracts, amazon-sp-api, mock adapters                                                                                               | Typed catalog, pricing, fee, restriction, and history seams; provenance and Decimal strings | One large adapter; capability entitlements and vendor-neutral rate budgets are not modeled                                              |
| SP-API live capabilities | Catalog Items projection, Product Pricing competitive summary, Product Fees estimates, Listings Restrictions, Sellers connection probe         | Server-only credentials, explicit partial/unknown states, FBA ≠ Amazon Retail               | Not a broad Amazon database; no licensed history, keyword, review, demand, or search-rank feed                                          |
| External observations    | ProviderObservation, fee components, provider attempts, raw evidence reference, freshness/completeness                                         | Explicit provider/operation/marketplace/time/request lineage                                | Observations are attached to EnrichmentItem → SupplierRow; unsuitable as the only research observation store                            |
| Financial decisions      | profit-engine, versioned policies/routes/results, exact fee quote acquisition                                                                  | Decimal/NUMERIC, formula gates, immutable audit inputs                                      | Wholesale cost model only; private-label quote economics belongs in a later deterministic extension                                     |
| Analysis                 | Server-side filters/pagination, saved scan views, virtualized grid, evidence drawer, active-view export                                        | Typed DTOs, bounded queries, honest partial/stale states                                    | workspace.tsx is already 2,282 lines and scan/profit-result specific                                                                    |
| Workflow                 | Shortlists, notes, audit events, PO builder, exports                                                                                           | Organization-scoped, idempotent, private, formula-safe                                      | Shortlist items require supplier rows and profit results; they cannot stand in for research projects                                    |
| Jobs                     | BullMQ worker, PostgreSQL outbox, checkpoints, retry/reconciliation                                                                            | At-least-once safe, canonical PostgreSQL state                                              | Queue/worker names and one processor are still scan-oriented                                                                            |
| Authentication           | Auth.js credentials, one owner role, private-organization proxy checks, local-only demo exception                                              | Fail-closed private deployment and membership revalidation                                  | Route handlers resolve a configured organization; there is no reusable request-principal service for future multi-organization features |
| Tests/operations         | Turborepo verification, Python checks, Compose integration, full browser upload flow, 50,000-row analysis fixture                              | Strong wholesale regression gate                                                            | No research golden dataset, history/keyword scale model, provider-license gate, or distinct research evaluation suite                   |

## Current ownership model

- Next.js owns user-facing commands and read APIs.
- PostgreSQL owns canonical jobs, checkpoints, observations, decisions, audit history, and workflow state.
- Redis is transport, not truth.
- The Node worker owns orchestration and provider calls.
- The Python scanner owns bounded, non-executing spreadsheet parsing and XLSX generation; it does not own business state.
- Deterministic TypeScript packages own matching, financial, order, and export rules.

This ownership model should remain intact for research. New research jobs should use the outbox/worker pattern without being forced through ScanJob.

## Documentation-to-code reconciliation

| Topic              | Repository truth                                                                                                                                | Roadmap treatment                                                                                            |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Worker ownership   | ADR 0002 and code use a Node BullMQ worker plus a Python scanner, not a Python-owned job queue                                                  | Preserve Node orchestration and the explicit scanner HTTP boundary                                           |
| UI stack           | The web app uses custom CSS, TanStack Table/Virtual, and local components; Tailwind/shadcn from the original blueprint were not adopted         | Extend the current design system; do not introduce a second system merely to match an old blueprint          |
| Product state      | PRODUCT and code include Phase 7.6 catalog/offers/fees/restrictions and a typed analysis workspace                                              | Treat wholesale as an implemented baseline, not a rewrite target                                             |
| History            | A minimal MarketHistoryProvider and mock history exist, but live licensed history and historical analytics are deferred                         | Add a licensed adapter only after entitlement/terms approval, then add deterministic analytics               |
| Tenant boundary    | Tables/repositories are organization-scoped, while request organization resolution is private-single-org oriented                               | Centralize the authenticated principal before many research APIs; keep every query organization-scoped       |
| Catalog identity   | CatalogProduct is provider-keyed and holds projection plus observation metadata; marketplaceId is nullable and the unique key omits marketplace | Evolve carefully in Prompt 02; do not create a duplicate product truth table or assume cross-market identity |
| Observation target | Wholesale ProviderObservation belongs to an enrichment item/supplier row                                                                        | Introduce research observation subjects/jobs rather than dummy scan records                                  |
| ADR numbering      | Two accepted ADRs use number 0014                                                                                                               | Correct numbering/indexing in a documentation-safe follow-up; do not rewrite migration history               |
| User documentation | Operational/domain docs are stronger than the five-line private user guide                                                                      | Expand task-oriented research docs with each research slice                                                  |

## High-coupling hazards before expansion

Line counts exclude generated, build, and virtual-environment files.

| Priority | Module                                  |      Size | Coupling risk                                                                                                 | Safe extraction target                                                                              |
| -------- | --------------------------------------- | --------: | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| 1        | packages/database/src/repositories.ts   |     4,928 | Upload, matching, enrichment, analysis, workflow, export, retention, and outbox transactions share one module | Split repositories by aggregate while keeping exports stable                                        |
| 2        | apps/web/src/analysis/workspace.tsx     |     2,282 | Fetching, query state, virtualization, editing, refresh/export, evidence, and rendering are interleaved       | Extract query hook/state, toolbar, grid, editors, drawer, and feedback components                   |
| 3        | packages/amazon-sp-api/src/index.ts     |     1,197 | Catalog, pricing, fees, restrictions, rate limiting, normalization, and vault concerns share one file         | Extract capability clients/normalizers and shared transport policy                                  |
| 4        | apps/worker/src/enrichment.ts           |     1,104 | Orchestration, batching, status mapping, retry, provenance, and persistence are interleaved                   | Extract coordinator, capability handlers, observation mapping, retry/budget, and checkpoint modules |
| 5        | apps/web/app/uploads/page.tsx           |       721 | Upload, polling, wizard state, mapping, safety, and progress are combined                                     | Defer unless safe capacity remains; extract characterized workflow state/components                 |
| 6        | apps/worker/src/profit.ts and export.ts | 625 / 603 | Future private-label and research exports could inflate wholesale coordinators                                | Add separate research coordinators rather than research branches                                    |

Prompt 01 should normally choose the first four, or a safer 2–3 subset if characterization tests demand it. It must not alter routes, financial results, PackGuard, provider semantics, or tenant scope.

## Reusable platform concepts

| Existing concept                        | Research reuse                                                                              | Required guardrail or change                                                                    |
| --------------------------------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| CatalogProduct and ProductIdentifier    | ASIN/identifier anchor for researched products                                              | Make marketplace/provider identity explicit; never merge products without evidence              |
| Catalog identity projection             | Title, brand, manufacturer, variation, images, dimensions, ranks when returned              | Keep raw evidence private and browser fields typed; absent means unknown                        |
| ProviderConnection and credential vault | Server-side Amazon authorization                                                            | Generalize capabilities without exposing secrets or forcing every vendor into Amazon enums      |
| Provider contracts and Zod schemas      | Base for history, keyword, rank, category, brand, seller, advertising, and review providers | Split by capability; add entitlement/budget/completeness; do not require unrelated capabilities |
| Provenance/freshness/completeness       | Universal truth envelope                                                                    | Add entitlement, window, methodology/model version, rights, and lineage where applicable        |
| ProviderCallAttempt                     | Provider telemetry and recovery                                                             | Support generic research jobs; retain sanitized keys only                                       |
| Outbox/checkpoints/BullMQ               | Research refresh, imports, tracking, exports, reports                                       | Add a first-class ResearchJob target/handler registry; do not overload scan stages              |
| AnalysisView query-state pattern        | Saved research filters/presets                                                              | Extract a versioned saved-view contract while preserving scan views                             |
| WorkflowAuditEvent                      | Project, decision, watch, alert, and launch audit                                           | Use allowlisted event contracts per aggregate                                                   |
| Private object storage/export engine    | Authorized imports, reports, raw evidence                                                   | Enforce data rights, private download, retention, text identifiers, and formula safety          |
| Decimal and profit/order engines        | Research scenarios and later private-label economics                                        | Extend versioned deterministic inputs; never calculate money in UI or AI                        |
| Test fixtures/release commands          | Provider mocks and golden datasets                                                          | Add schema-drift, sparse history, entitlement, tenant, and accuracy fixtures                    |

## Target architecture and boundaries

The shared platform should contain marketplace catalog identity, provider capability/truth handling, research jobs/outbox/budgets/cache, and audit/evidence/exports. Wholesale and research both consume those primitives. Research adds normalized time series, deterministic metrics, opportunity assessments, projects, launch, and monitoring. AI remains a separate evidence-grounded interpretation layer.

Boundary rules:

1. Wholesale tables/routes remain stable and keep passing current release gates.
2. Research projects reference existing catalog identities; they do not duplicate ASIN/product truth.
3. Research observations are marketplace-, subject-, provider-, operation-, and time-specific.
4. Raw observations and normalized projections remain separate. Derived metrics never overwrite evidence.
5. Deterministic metrics store calculation/model version, window, inputs, coverage, confidence, and calculated_at.
6. AI output is labeled interpretation/hypothesis with evidence references. It is never the source of money, sales, rank, seasonality, or opportunity math.
7. Capability, entitlement, rate budget, cache policy, and data rights are checked before queueing, display, or export.
8. Unknown, partial, stale, unauthorized, throttled, quota-exhausted, unsupported, and unlicensed remain distinct.

## Minimum package and module plan

Avoid one package per screen. The minimum justified additions are:

1. **packages/research-domain** — project, market, keyword, observation-subject, opportunity, watch, and alert contracts without provider implementations.
2. **packages/research-engine** — deterministic/versioned history, aggregation, seasonality, scoring, comparison, and later optimization functions. Decimal remains mandatory for money and money-derived ratios.
3. **Provider-runtime modules inside existing provider packages** — capability discovery, entitlement, budgets, dedupe, cache, telemetry, and data rights. Public contracts remain in provider-contracts and vendor semantics stay out of domain code.
4. **Research modules in apps/worker** — handler registry, research-job coordinator, refresh handlers, scheduled tracking, and aggregation jobs. Reuse BullMQ/outbox; do not add another queue framework.
5. **Feature folders in apps/web** — research/projects, products, keywords, markets, and shared evidence/filter components. Keep query modules separate from presentation.

Do not add a database, search service, warehouse, or time-series product until Prompt 33 proves a PostgreSQL limitation.

## Minimum additive schema plan

The exact Prisma design belongs to Prompt 02.

### Research workflow

| Model                | Purpose                                                                    | Integrity/index expectations                                    |
| -------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------- |
| ResearchProject      | Organization-owned wholesale/manual/private-label research container       | organization_id, mode, status, version; org/status/update index |
| ResearchProjectItem  | Reference to catalog product, market, niche, keyword set, brand, or seller | Typed kind/reference; unique project/kind/reference             |
| ResearchTag and join | Organization-owned categorization                                          | Unique normalized label per organization                        |
| ResearchNote         | Evidence-linked notes                                                      | Org/project/created-time index                                  |
| ProductWatch         | Marketplace product watch configuration                                    | Unique org/marketplace/product; cadence and active state        |
| MarketDefinition     | Frozen or dynamic competitor/niche universe                                | Versioned definition/query and marketplace                      |
| MarketMember         | Membership with inclusion source/window                                    | Unique market/member/version; joined/left timestamps            |

### Research jobs and truth layer

| Model                                    | Purpose                                                         | Integrity/index expectations                                                           |
| ---------------------------------------- | --------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| ResearchJob and ResearchCheckpoint       | Provider/import/aggregation/export work                         | Idempotency, status, capability, budget snapshot, cancellation; unique stages          |
| ProviderCapability / ProviderEntitlement | Connection capability/access state                              | Org/connection/marketplace/capability uniqueness; checked/expiry times                 |
| ProviderRateBudget                       | Request/token/credit budget window                              | Provider/capability/window; atomic reservation/reconciliation                          |
| ProviderCacheEntry                       | Request-deduplicated normalized cache metadata                  | Sanitized hash, marketplace, capability, freshness, rights policy                      |
| ObservationSubject                       | Target for product, keyword, market, category, brand, or seller | Org/marketplace/type/reference; no supplier-row requirement                            |
| ProviderObservationLineage               | Generic request/raw evidence lineage                            | Provider, operation, entitlement, hash, time, completeness, private evidence reference |

### Keywords, series, aggregates, and decisions

| Model                                | Purpose                                    | Integrity/index expectations                                                      |
| ------------------------------------ | ------------------------------------------ | --------------------------------------------------------------------------------- |
| Keyword                              | Original phrase, normalized key, locale    | Unique org/marketplace/locale/normalized phrase; original retained                |
| KeywordObservation                   | Volume/trend/provider observations         | Subject/provider/metric/window/time dedupe                                        |
| ProductKeywordObservation            | Organic/sponsored/relevancy relation       | Product/keyword/provider/time; missing rank is null                               |
| HistoricalMetricSeries and Point     | Sparse normalized history                  | Series includes org/marketplace/subject/metric/provider; unique time/source point |
| ProductMarketObservation             | Product metrics in explicit market         | Market version/product/time/provider window                                       |
| MarketObservation                    | Market rollups                             | Market version/window/calculation version/member snapshot                         |
| CategoryObservation                  | Category aggregates                        | Category/provider universe/window; coverage mandatory                             |
| BrandObservation / SellerObservation | Optional licensed/derived aggregates       | Resolution confidence, universe, provider, window, completeness                   |
| OpportunityAssessment / Reason       | Deterministic score and decomposed reasons | Version, inputs, thresholds, calculation time; immutable                          |
| AlertRule / AlertEvent               | Monitoring foundation                      | Organization scope, dedupe, cooldown, evidence, observed time                     |

Schema guardrails:

- NUMERIC/Decimal for money and money-derived ratios.
- Strings for ASIN/UPC/EAN/GTIN; preserve leading zeros.
- Organization/marketplace/time indexes on expected reads and indexes on foreign keys.
- Dedupe keys include provider, operation, marketplace, subject, metric/data class, and source identity.
- Raw provider evidence remains private/retention-bounded; UI does not interpret raw JSON.
- High-volume point tables are partition-ready, but partition only after Prompt 33 measurements.
- Every additive migration has a reviewed rollback path; destructive rollback requires backup/restore review.

## Research domain map

| Domain                     | Responsibility                                   | Dependencies                              | Output                                   |
| -------------------------- | ------------------------------------------------ | ----------------------------------------- | ---------------------------------------- |
| Market History             | Licensed sparse histories                        | Provider runtime, licensed approval       | Series with coverage/provenance          |
| Product Discovery          | Query an explicit honest universe                | Catalog/search entitlement                | Products saved to projects               |
| Category Intelligence      | Aggregate explicit category universe             | Product universe/history/estimates        | Coverage-labeled category observations   |
| Niche Intelligence         | Define keyword/category/competitor markets       | Keywords, markets, metrics                | Deterministic opportunity components     |
| Keyword Intelligence       | Seed, related, reverse-ASIN, first-party metrics | Licensed provider/eligible Amazon reports | Phrases, observations, matrices          |
| Rank Tracking              | Scheduled product-keyword observations           | Rank provider, budgets, scheduler         | Sparse history and alerts                |
| Brand Intelligence         | Resolve/aggregate known brand universe           | Catalog/licensed evidence                 | Confidence/coverage brand views          |
| Seller Intelligence        | Optional authorized seller observations          | Licensed provider/data rights             | Seller views without ownership invention |
| Competitor/Market Tracking | Versioned membership and snapshots               | Markets/products/history                  | Entrants, exits, shares, change feed     |
| Review Intelligence        | Authorized records and themes                    | Licensed or imported reviews, AI          | Themes linked to records                 |
| Listing Intelligence       | Rules and grounded suggestions                   | Verified facts/keywords                   | Checklist/drafts with claim map          |
| Launch Planning            | Stage-gated execution                            | Approved project/economics/compliance     | Plan tied to decision evidence           |
| Projects/Boards            | Central research workflow                        | All research domains                      | Replayable project/decision memo         |
| Monitoring/Alerts          | Idempotent change detection                      | Watches/scheduler/observations            | Deduped evidence-bearing alerts          |

## Data-source and truth-class matrix

Truth classes:

- **Official-account data** — authorized Amazon API/report for the connected seller/brand; not automatically broad market truth.
- **Licensed third-party data** — provider data whose contract permits the intended use, cache, display, retention, and export.
- **User-authorized import** — data the user is entitled to upload and store privately.
- **Derived data** — deterministic calculation over cited observations with version/window/coverage.
- **AI interpretation** — non-authoritative classification, summary, or hypothesis linked to evidence.

| Data or metric                                                                                                                                       | Likely source                                                                     | Truth class                         | Required rule                                                                              |
| ---------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------ |
| ASIN, identifiers, title, brand/manufacturer, model, size/color, dimensions, images, variation/package relations, product type, returned sales ranks | Catalog Items SP-API; licensed catalog provider for broader universe              | Official-account or licensed        | Store source/operation/marketplace/time/completeness; absent is unknown                    |
| Featured offer, returned lowest FBA/FBM, offer sample, Amazon Retail presence                                                                        | Product Pricing SP-API or licensed offers provider                                | Official-account or licensed        | FBA ≠ Amazon Retail; incomplete samples do not prove totals/absence                        |
| Account-specific fees                                                                                                                                | Product Fees SP-API                                                               | Official-account                    | Price/fulfillment/currency-specific estimate; components/time/completeness; not guaranteed |
| Account-specific eligibility/restrictions                                                                                                            | Listings Restrictions SP-API                                                      | Official-account                    | Only complete explicit empty restrictions means eligible                                   |
| Price, BSR, offer-count, Amazon-presence, rating/review-count history, listing age                                                                   | Approved MarketHistoryProvider such as licensed Keepa if terms permit             | Licensed                            | Sparse series, honest gaps, coverage, retention/redistribution policy                      |
| Window medians/percentiles, volatility, drawdown, BSR trend, stability, seasonality, Amazon presence percentage                                      | research-engine over licensed history                                             | Derived                             | Version, source IDs, window, coverage/confidence; missing periods not zero                 |
| Broad product universe/counts                                                                                                                        | Licensed catalog/category/search provider or explicitly tracked/imported universe | Licensed plus derived               | Name universe and coverage; SP-API lookup is not a global database                         |
| Search volume/history, related terms, title density, keyword competition, dominant ASINs                                                             | KeywordIntelligenceProvider                                                       | Licensed                            | Preserve original phrase and methodology/window; never fabricate volume                    |
| ABA/SQP query/click/purchase share when eligible and officially available                                                                            | Authorized Amazon reports                                                         | Official-account                    | Eligibility/date-window gated; distinct from estimates                                     |
| Organic/sponsored rank, reverse-ASIN, share-of-voice                                                                                                 | SearchRankProvider or authorized first-party source                               | Licensed or official-account        | Timestamp/context; missing rank unknown, not zero                                          |
| Sponsored density, CPC/bid estimates, competitor ad visibility                                                                                       | AdvertisingIntelligenceProvider or authorized Amazon Ads                          | Licensed or official-account        | Capability-gated; no page scraping; estimates labeled                                      |
| Monthly units/revenue                                                                                                                                | SalesEstimateProvider or calibrated category/market model                         | Licensed estimate or derived model  | Provider/model version, range/confidence; never “Amazon-reported”                          |
| Category size, revenue/units, review barrier, concentration, new-entry rate                                                                          | Named licensed/tracked universe aggregate                                         | Derived                             | Member universe/version/window/coverage; no unsupported market-size claim                  |
| Brand/seller product counts, mix, estimates, growth                                                                                                  | Licensed provider plus known-universe aggregate                                   | Licensed plus derived               | Entity confidence; never infer brand ownership from seller name                            |
| Product relationships                                                                                                                                | Licensed relationship data or deterministic similarity                            | Licensed or derived                 | Label relationship type/source; similarity is not Amazon behavior                          |
| Review/rating records/text                                                                                                                           | Review provider or user import                                                    | Licensed or user-authorized         | Minimize personal data; dedupe, source IDs, retention rights                               |
| Pain-point themes/differentiation ideas                                                                                                              | Evidence-grounded AI over authorized facts                                        | AI interpretation                   | Link evidence; distinguish hypothesis; no invented claims                                  |
| Listing quality/keyword coverage                                                                                                                     | Deterministic rules over authorized facts                                         | Derived                             | Decomposable/versioned; no ranking-causality claim                                         |
| Listing copy/differentiation brief                                                                                                                   | AI over verified facts/keywords                                                   | AI interpretation                   | Claim/evidence map; unverified facts block approval                                        |
| Opportunity/niche score and comparisons                                                                                                              | research-engine                                                                   | Derived                             | Components, thresholds, coverage, input refs; low data = low confidence                    |
| Compliance/certification risk                                                                                                                        | Curated rules + restrictions + optional AI classification                         | Official rule evidence, derived, AI | Jurisdiction/version; unknown stays unknown; not legal advice                              |
| Private-label landed cost/profit/ROI/margin/break-even/cash                                                                                          | Supplier/user inputs + fees + engine                                              | User-authorized plus derived        | Decimal, formula version, dated costs/FX, uncertainty visible                              |
| Portfolio allocation/stress                                                                                                                          | Deterministic optimizer                                                           | Derived                             | Reproducible constraints/version; AI explanation only                                      |

### What SP-API cannot provide as broad competitor truth

The current SP-API boundary is appropriate for per-ASIN catalog identity, current permitted pricing/offer evidence, account-specific fees, and seller-specific listing restrictions. It must not be treated as a complete source for:

- longitudinal price, BSR, offer-count, Amazon-presence, rating, or review-count history;
- a searchable global product/category database with market-wide counts;
- broad keyword volume/history, reverse-ASIN ranks, or competitor keyword gaps;
- calibrated competitor sales/revenue estimates;
- review text and customer pain-point corpora;
- broad brand, seller, storefront, market-share, entrants/exits, or sponsored intelligence;
- verified seller-to-brand ownership;
- customer-behavior graphs unless an authorized source explicitly supplies them.

Those features stay unavailable until a licensed/authorized source is selected. Mocks verify contracts but never appear as live observations.

## Phased implementation roadmap and release gates

### Foundation — Prompts 01–03

**Dependencies:** current wholesale release gate.  
**Work:** modularize hotspots; add research foundations; add entitlements, budgets, cache/dedupe, health, data rights, and research jobs.

Release gate:

- wholesale unit/integration/browser/50k gates stay green;
- new schemas are additive, reversible, tenant-scoped, indexed, and migration-validated;
- cross-tenant tests cover every new repository;
- provider secrets remain server-only and mock cannot masquerade as live;
- research does not require synthetic scan/supplier rows;
- unconfigured/unauthorized/throttled/quota/partial states have contract tests.

### Data truth — Prompts 04–05

**Dependencies:** provider runtime and approved provider/subscription/terms.  
**Work:** licensed market history, sparse normalized storage, deterministic analytics/charts.

Release gate:

- live and fixture verification are reported separately;
- budgets, batching, retry, cache, retention, and export rights match provider terms;
- sparse histories never create zeroes or interpolation;
- golden calculations cover windows, volatility, trend, seasonality, coverage, and anomalies;
- charts expose source, window, observed time, and coverage.

### Discovery — Prompts 06–09

**Dependencies:** catalog-universe entitlement/history; estimates need a provider or calibrated data.  
**Work:** Product Explorer, category intelligence, niche finder, demand estimation.

Release gate:

- every result count names its universe;
- server filters/pagination pass representative scale tests;
- aggregate membership/coverage reconciles to golden fixtures;
- opportunity components are deterministic/decomposable;
- estimates have source/model/range/confidence;
- no uncalibrated BSR heuristic appears as sales.

### Keywords — Prompts 10–13

**Dependencies:** keyword/rank provider and optional eligible first-party reports.  
**Work:** Keyword Explorer, reverse-ASIN/gap, ABA/SQP, scheduled rank tracking.

Release gate:

- original phrases and provider metrics remain distinct;
- multi-ASIN missing observations are correct;
- first-party data is distinct from estimates;
- scheduler is idempotent/quota-aware;
- rank history never zero-fills missing observations.

### Market and competition — Prompts 14–18

**Dependencies:** product/keyword/history foundations and provider capabilities.  
**Work:** tracking, brand/seller intelligence, relationship graph, optional advertising.

Release gate:

- frozen/dynamic membership is versioned/replayable;
- entrants/exits/shares reconcile to member snapshots/windows;
- entity resolution exposes confidence and never invents ownership;
- data rights gate fields/exports;
- derived relationships are not labeled Amazon customer behavior.

### Customer and differentiation — Prompts 19–20

**Dependencies:** licensed or user-authorized reviews.  
**Work:** review ingestion/themes and product differentiation.

Release gate:

- no review-page scraping;
- dedupe, language, retention, personal-data minimization pass;
- every AI theme links supporting records;
- prompt-injection/unsupported-claim evals pass;
- hypotheses are visually distinct from facts.

### Listing and launch — Prompts 21–23

**Dependencies:** verified facts, keywords, differentiation, approved project.  
**Work:** listing analysis, grounded drafts, launch plan.

Release gate:

- scores decompose into versioned rules;
- factual claims trace to verified facts and unverified claims block approval;
- launch plan retains its research/decision snapshot;
- no Seller Central write or purchase action occurs.

### Economics, risk, and portfolio — Prompts 24–26

**Dependencies:** quote inputs, profit foundation, curated compliance sources.  
**Work:** private-label scenarios, compliance screen, portfolio optimizer.

Release gate:

- wholesale examples remain cent-for-cent stable;
- all money/FX/ratios use Decimal/NUMERIC and dated sources;
- audited examples, rounding, guards, stress, and solver property tests pass;
- unknown compliance remains unknown and is not legal advice;
- identical inputs yield identical allocation/exclusion.

### Workflow and experience — Prompts 27–32

**Dependencies:** stable research domains.  
**Work:** projects/memos, extension, copilot, alerts, marketplaces, cohesive UI.

Release gate:

- decisions replay immutable snapshots;
- extension uses minimum permissions and no provider secrets;
- AI retrieval is allowlisted, tenant-scoped, bounded, and cited;
- alerts dedupe and never treat missing values as zero;
- currency/timezone/market differences are explicit;
- responsive/accessibility browser tests pass without degrading wholesale.

### Hardening and final audit — Prompts 33–36

**Dependencies:** all selected non-optional research modules.  
**Work:** measured scale, security/data-rights, golden datasets/evals, integration audit.

Release gate:

- 100k product / 1M observation / 5M keyword-product equivalent benchmarks meet documented budgets or have an approved plan;
- no N+1 provider calls or UI-triggered provider fan-out;
- retention/downsampling preserves audit and provider terms;
- tenant, IDOR, SSRF, prompt injection, upload/export, secret, extension, and license tests pass;
- formula/model changes require version/golden changes;
- wholesale and research journeys pass with limitations/live dependencies documented;
- no production-ready claim without live-provider and real-user validation.

### Optional Prompts 37–38

Completing Prompt 36 does not authorize commercialization or differentiators. Prompt 37 begins only after private real-data reliability and explicit approval. Prompt 38 selects evidence-supported differentiators one at a time.

## Cross-cutting test strategy

Each research slice adds the narrowest applicable layers:

1. Contract fixtures: recorded/redacted schemas, entitlement, throttle, partial payload, schema drift, absent fields.
2. Deterministic unit/property tests: sparse series, windows, currency, Decimal math, membership, scores, optimizer.
3. Database/migration tests: rollback review, tenant filters, dedupe, lineage, foreign-key indexes, ordering.
4. Integration tests: PostgreSQL/outbox/worker/cache/mocks, retry/resume, cancellation, budgets, stale refresh.
5. Browser/accessibility tests: honest unsupported/partial/stale states, pagination, evidence, views, export, keyboard, responsive.
6. Scale tests: bounded memory/query counts for products, time series, keyword matrices, aggregates, exports.
7. AI evaluations: evidence grounding, missing data, unsupported claims, prompt injection, tenant isolation.
8. Live opt-in smoke tests: never CI-required; only explicit credentials, with no sensitive logs.

The existing wholesale baseline remains mandatory:

- pnpm verify
- pnpm test:integration
- pnpm test:scale
- pnpm test:browser
- pnpm test:scale:browser
- docker compose config --quiet
- docker compose up --build --wait --wait-timeout 300

Prompt 35 should consolidate research contract, golden, migration, and benchmark commands into one documented release gate.

## Principal risks and controls

| Risk                         | Why it matters                                                          | Control                                                                       |
| ---------------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Wholesale regression         | Research could change matching, PackGuard, financial, or scan contracts | Separate bounded context, characterization tests, mandatory wholesale gates   |
| Product identity duplication | Provider records could conflict                                         | Reuse/evolve CatalogProduct; retain provider identity and resolution evidence |
| Observation coupling         | Supplier-row observations cannot represent research subjects            | Add observation subject/research job; no fake uploads/scans                   |
| Vendor lock-in               | Provider payload could leak into product logic                          | Capability contracts, normalized projections, vendor-neutral runtime          |
| Licensing breach             | Fields may have cache/display/export limits                             | Persist rights metadata and enforce in cache/API/UI/export/retention          |
| False market certainty       | Partial universes can look global                                       | Name universe/window/coverage on every aggregate/count                        |
| Cost runaway                 | Discovery/tracking multiplies calls                                     | Preflight budgets, dedupe, cache, bounded concurrency, cancellation           |
| Time-series growth           | Product/keyword history grows rapidly                                   | Composite indexes, retention/downsampling, measured partitioning              |
| Tenant leakage               | Flexible research queries increase IDOR risk                            | Central principal, org repositories, composite checks, cross-tenant tests     |
| AI injection/hallucination   | Imported text can manipulate summaries                                  | Allowlisted tools, citations, fact/hypothesis separation, injection evals     |
| Cross-market errors          | Currency/category/locale differ                                         | Marketplace registry, dated FX, market models, labeled comparisons            |

## Prompt 00 acceptance record

- **PASS — Repository-grounded:** cites actual apps, packages, models, worker ownership, routes, providers, UI, tests, and measured hotspots.
- **PASS — Wholesale remains first-class:** wholesale aggregates/gates are preserved; research gets separate jobs/subjects/workflows.
- **PASS — Source classification:** market-wide metric families are classified as official-account, licensed, user-authorized, derived, or AI.
- **PASS — No scraping dependency:** no production Amazon HTML scraping is proposed.
- **PASS — Phased release criteria:** every major group has dependencies and explicit correctness, security, rights, test, and scale gates.

## Next checkpoint

Prompt 01 should modularize the highest-risk hotspots without observable behavior changes. It begins with characterization tests and preserves all wholesale routes and release gates. No research schema or feature work should start until that checkpoint passes.
