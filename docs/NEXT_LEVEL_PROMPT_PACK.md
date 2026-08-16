RIZPOINT SOURCING OS
NEXT-LEVEL AMAZON RESEARCH PLATFORM
CODEX PROMPT PACK
Version: 2026-08-16

PURPOSE
=======
This file is a stage-by-stage prompt pack for taking the existing private repository:

    RealJabran/rizpoint-sourcing-os

from a strong wholesale sourcing engine into a much broader Amazon research platform for:
- wholesale sourcing,
- private-label product discovery,
- niche research,
- keyword research,
- market and competitor intelligence,
- product tracking,
- listing research,
- launch planning,
- profitability/risk analysis,
- historical market intelligence,
- research automation,
- browser-assisted research,
- and eventually a commercial SaaS if desired.

IMPORTANT: DO NOT ask Codex to "build the whole thing" in one prompt.
Run these prompts in order. Let Codex inspect the repository, implement one bounded vertical slice, test it, and update documentation before moving on.

CURRENT BASELINE TO PRESERVE
============================
The existing repository already has substantial functionality. Do not rebuild these features from scratch:

- supplier CSV/XLS/XLSX ingestion and mapping,
- normalized supplier rows,
- deterministic ASIN/UPC/EAN/GTIN/title matching,
- PackGuard / pack contradiction protection,
- Amazon SP-API provider boundary,
- catalog, competitive offer, fee, and listing-restriction evidence,
- Decimal/NUMERIC profitability calculations,
- analysis workspace,
- saved filters/views,
- shortlists,
- purchase orders,
- safe CSV/XLSX exports,
- private object storage,
- queue/worker architecture,
- authentication/private-production safeguards,
- auditability/provenance/freshness,
- browser/integration/unit tests,
- CI and Docker Compose.

The repository currently describes itself primarily as an Amazon wholesale sourcing system. This prompt pack EXPANDS it; it must not destroy or weaken the existing wholesale workflow.

TARGET PRODUCT
==============
The target is a unified platform with two first-class modes:

1. WHOLESALE SOURCING
   Supplier catalog -> match -> enrich -> calculate -> shortlist -> PO

2. AMAZON MARKET RESEARCH / PRIVATE LABEL
   Market/category/keyword -> discover ASINs/niches -> analyze history/demand/competition
   -> compare opportunities -> estimate economics -> differentiation research
   -> listing/launch plan -> monitor

The platform should feel like one coherent research operating system rather than a collection of disconnected tools.

FEATURE BENCHMARKS / INSPIRATION
================================
Use these only as workflow/feature inspiration. DO NOT copy proprietary code, branding, exact UI, proprietary scores, or private datasets.

Relevant public feature families as of 2026 include:
- Helium 10: Black Box-style product discovery, reverse-ASIN/keyword research, Market Tracker,
  keyword tracking, listing analysis/building, product research extension, launch planning.
- SmartScout: product/brand/seller/subcategory intelligence, traffic graph, ad/search-term
  intelligence, UPC scanning, keyword/product relevance, market-level analytics.
- Jungle Scout: Product Database, Opportunity Finder, Product Tracker, Category Trends,
  keyword research, listing quality/review feedback, sales/profitability analytics.

The goal is NOT to clone any of these products.
The goal is to build RizPoint's own explainable, evidence-first research workflow.

DATA ACCESS RULE
================
Never make scraping Amazon HTML the core production data strategy.

For any external metric:
- use official Amazon APIs where they legitimately expose the required account-specific data;
- use licensed/authorized third-party providers for historical or market-wide datasets;
- place providers behind typed interfaces;
- preserve provider, operation, observed_at, freshness, completeness, and entitlement state;
- implement deterministic mock/recorded fixtures when a live key is unavailable;
- never fabricate "live" data in the UI;
- never silently substitute mock data for a failed live provider.

Potential provider classes include:
- Amazon SP-API
- MarketHistoryProvider (for example Keepa or another licensed provider)
- KeywordIntelligenceProvider
- SearchRankProvider
- AdvertisingIntelligenceProvider
- ReviewIntelligenceProvider
- CategoryIntelligenceProvider

Do not hard-wire the business to one vendor where an interface is practical.

======================================================================
GLOBAL CODEX OPERATING CONTRACT
======================================================================

PASTE THIS AT THE START OF A NEW CODEX THREAD BEFORE THE PHASE PROMPT
(or keep it in the same thread and tell Codex to continue following it):

You are the lead architect and senior full-stack engineer for the existing
RizPoint Sourcing OS repository.

Before changing code:
1. Read AGENTS.md.
2. Read docs/PRODUCT.md and docs/ARCHITECTURE.md.
3. Read the relevant domain docs and ADRs.
4. Inspect the ACTUAL code, schema, migrations, tests, and existing behavior.
5. Do not assume documentation is perfectly current; reconcile docs with code.

Authorization:
- This request authorizes in-scope local repository reads, code edits, migrations,
  non-destructive test commands, lint/typecheck/build commands, and local fixture creation.
- Do not push to remote, deploy to production, purchase services, rotate real credentials,
  delete production data, or perform destructive external actions without explicit approval.
- Never commit secrets, tokens, private supplier sheets, customer data, or unredacted provider payloads.

Engineering rules:
- Preserve existing wholesale functionality and backward compatibility unless the phase explicitly changes a contract.
- Prefer small vertical slices and explicit module boundaries.
- Keep provider integrations behind typed interfaces.
- Financial calculations must remain deterministic and Decimal/NUMERIC based.
- AI can classify, cluster, summarize, suggest, and explain; AI must not be the authoritative calculator for money, fees, ROI, margins, demand estimates, rank math, or opportunity scores.
- Every external observation must retain provenance, timestamp, marketplace, freshness, completeness, and entitlement/access state.
- Unknown/partial/throttled/unauthorized/stale data must remain explicit.
- Jobs must be idempotent, retry-safe, organization-scoped, and resumable.
- Maintain tenant isolation even while the product is private.
- Do not build production Amazon HTML scraping.
- If a live external key/provider is unavailable, build the interface, adapter boundary, deterministic mock/recorded fixtures, tests, configuration, and honest UI states. Do not fake success.
- Avoid unrelated refactors.
- Migrations must be reversible.
- New behavior must have tests.
- Empty, loading, partial, stale, unauthorized, throttled, and failed states must be designed intentionally.
- Accessibility and responsive behavior are required for user-facing work.
- Update docs when behavior or architecture changes.

Workflow:
A. Inspect first.
B. Give a concise file-level implementation plan and list major risks.
C. Implement the approved scope in the same task unless a truly blocking ambiguity exists.
D. Run the narrow tests first, then the relevant full verification gates.
E. Fix failures caused by your changes.
F. Review the final diff for regressions/security/provider leakage.
G. Report:
   - files changed,
   - migrations,
   - tests/commands run and outcomes,
   - known limitations,
   - external credentials/data still required,
   - the next recommended phase.

Do not claim a feature is production-ready merely because mocks pass.

======================================================================
HOW TO RUN THIS PACK
======================================================================

Recommended workflow for EVERY numbered prompt:

1. Start from a clean branch/working tree.
2. Paste the GLOBAL CODEX OPERATING CONTRACT if this is a fresh Codex conversation.
3. Paste one numbered prompt below.
4. Let Codex inspect, plan, implement, test, and document.
5. Review the diff.
6. Commit the checkpoint locally.
7. Start the next prompt only after the current one passes its acceptance criteria.

If a prompt depends on an unavailable paid API:
- still implement the provider interface,
- config,
- entitlement state,
- mock/recorded provider,
- tests,
- rate-budget design,
- and UI behavior;
then connect the real provider later.

======================================================================
PROMPT 00 — FULL REPOSITORY AUDIT + NEXT-LEVEL ROADMAP
======================================================================

Perform a read-only architecture and product audit before implementing any new
Amazon market-research functionality.

Goal:
Produce a repository-grounded expansion plan that preserves the existing
wholesale engine while adding private-label/product/keyword/market research.

Tasks:
1. Inspect the entire repository tree and identify:
   - current wholesale workflows,
   - current provider contracts,
   - current Amazon SP-API capabilities,
   - current data model,
   - current queue/job architecture,
   - current analysis workspace,
   - current authentication/tenant model,
   - existing test coverage.
2. Compare current code against docs/PRODUCT.md, docs/MASTER_BLUEPRINT.md,
   docs/ARCHITECTURE.md, docs/DATA_DICTIONARY.md, and AGENTS.md.
3. Identify large/high-coupling modules that will become dangerous if we simply
   keep adding features.
4. Identify which existing concepts can be reused by the research platform:
   CatalogProduct, marketplace observations, evidence/provenance, filters,
   exports, shortlists, jobs, provider attempts, etc.
5. Design a top-level architecture for these new domains:
   - Market History
   - Product Discovery
   - Category Intelligence
   - Niche Intelligence
   - Keyword Intelligence
   - Rank Tracking
   - Brand Intelligence
   - Seller Intelligence
   - Competitor/Market Tracking
   - Review Intelligence
   - Listing Intelligence
   - Launch Planning
   - Research Projects/Boards
   - Monitoring/Alerts
6. Recommend the minimum new schemas/packages/modules needed.
7. Explicitly identify data that SP-API cannot reliably provide for broad
   competitor research and therefore needs a licensed provider.
8. Produce a phased implementation roadmap with dependencies and release gates.

Deliverable:
Create docs/NEXT_LEVEL_RESEARCH_ROADMAP.md.

Do not implement the research features yet.
Do not modify runtime behavior except documentation if necessary.

Acceptance criteria:
- Roadmap is based on actual current code.
- Wholesale workflow remains first-class.
- Every proposed market-wide metric names its likely source class and
  explicitly states whether it is official-account data, licensed third-party
  data, derived data, or AI interpretation.
- No scraping dependency is proposed.
- Each major phase has test/release criteria.

======================================================================
PROMPT 01 — MODULARIZE HIGH-RISK HOTSPOTS BEFORE EXPANSION
======================================================================

Prepare the repository for significant new functionality by reducing the most
dangerous high-coupling modules.

Goal:
Refactor selected oversized files without changing externally observable behavior.

Start by inspecting current file sizes and responsibilities. Pay special
attention to areas such as:
- the analysis workspace,
- database repositories,
- worker enrichment,
- Amazon SP-API integration,
or whichever files are currently the largest/cross-cutting.

Requirements:
1. Do NOT do a giant rewrite.
2. Choose the 2-4 highest-value modularization targets.
3. Extract cohesive modules/components/repositories while preserving public APIs.
4. Add characterization tests before moving logic when useful.
5. Do not alter profitability, matching, PackGuard, provider semantics, or tenant scope.
6. Preserve all current routes.
7. Run existing unit/integration/browser tests relevant to moved code.
8. Document new module boundaries in docs/ARCHITECTURE.md.

Acceptance criteria:
- No feature behavior changes.
- No weakened tests.
- Large components are split along domain boundaries, not arbitrary line counts.
- Public interfaces remain stable unless a migration path is documented.
- Full relevant verification passes.

======================================================================
PROMPT 02 — EXPAND PRODUCT MISSION + RESEARCH DOMAIN MODEL
======================================================================

Implement the architectural foundation for a dual-mode platform:
WHOLESALE + AMAZON MARKET RESEARCH.

Goal:
Add research-domain entities without breaking supplier-scan entities.

Design first, then implement:
- ResearchProject
- ResearchProjectItem
- ResearchTag
- ResearchNote
- ProductWatch
- MarketDefinition
- MarketMember
- Keyword
- KeywordObservation
- ProductKeywordObservation
- ProductMarketObservation
- MarketObservation
- CategoryObservation
- BrandObservation
- SellerObservation
- HistoricalMetricSeries / normalized history storage strategy
- OpportunityAssessment
- OpportunityReason
- AlertRule / AlertEvent foundations where appropriate

Requirements:
1. Inspect existing schema first and REUSE existing CatalogProduct/provider
   observation concepts where correct.
2. Avoid duplicate "product" truth tables.
3. Every observation must be marketplace-specific and time-aware.
4. External observations need provenance/freshness/completeness.
5. Derived metrics need:
   - calculation version,
   - input observation references,
   - calculated_at.
6. ResearchProject should support both:
   - private-label research,
   - wholesale/manual ASIN research.
7. Add organization scoping and indexes for expected queries.
8. Add reversible migrations.
9. Add repository/service contracts and tests.
10. Update PRODUCT, ARCHITECTURE, DATA_DICTIONARY and add ADR(s).

Do not build the full UI yet.

Acceptance criteria:
- Wholesale schemas/routes still work.
- Research entities are normalized and tenant-scoped.
- Time-series storage has an explicit retention/index strategy.
- Derived scores cannot overwrite raw provider observations.

======================================================================
PROMPT 03 — PROVIDER ENTITLEMENTS, RATE BUDGETS, CACHE + DATA TRUTH LAYER
======================================================================

Build the shared provider foundation required for multiple licensed research APIs.

Goal:
Before adding Keepa/keyword/history vendors, create one consistent mechanism for:
- credentials,
- entitlement/capability state,
- rate budgets,
- request deduplication,
- caching,
- retries,
- observation persistence,
- cost accounting,
- provider health,
- partial data.

Add/extend abstractions for provider capability discovery:
- CATALOG
- COMPETITIVE_OFFERS
- FEES
- RESTRICTIONS
- MARKET_HISTORY
- KEYWORD_DISCOVERY
- REVERSE_ASIN
- SEARCH_RANK
- CATEGORY_INTELLIGENCE
- BRAND_INTELLIGENCE
- SELLER_INTELLIGENCE
- AD_INTELLIGENCE
- REVIEW_INTELLIGENCE

Requirements:
1. Never expose provider secrets to the browser.
2. Distinguish:
   NOT_CONFIGURED,
   CONFIGURED,
   AUTHORIZED,
   UNAUTHORIZED,
   QUOTA_EXHAUSTED,
   THROTTLED,
   UNAVAILABLE,
   PARTIAL,
   HEALTHY.
3. Add cache freshness policies per data class.
4. Add request/rate-budget telemetry that does not leak payloads.
5. Add estimated provider-call cost/credits where a provider exposes a credit model.
6. Add idempotency and concurrency controls.
7. Make UI/API able to say exactly WHY a metric is unavailable.
8. Add mock providers and fault tests.

Acceptance criteria:
- Existing SP-API adapter still works through the normalized provider framework.
- Provider failures never become zeroes.
- Mock mode can never masquerade as live mode.
- Rate-budget exhaustion is recoverable and visible.

======================================================================
PROMPT 04 — LICENSED MARKET HISTORY PROVIDER (KEEPA-FIRST ADAPTER)
======================================================================

Implement the first real MarketHistoryProvider adapter, using Keepa as the first
supported vendor IF its current licensed API and the user's credentials permit
the required use. Keep the interface vendor-neutral.

Goal:
Enrich ASINs with historical market evidence that SP-API alone does not provide.

Support normalized historical observations for available fields such as:
- Amazon price history,
- new/featured offer price history,
- sales-rank history,
- offer-count history,
- Amazon Retail availability/presence history,
- rating/review-count history when licensed data provides it,
- product age/first-observed information,
- category/rank context.

Requirements:
1. Inspect current provider contracts and extend rather than bypassing them.
2. Build:
   - MarketHistoryProvider interface,
   - Keepa adapter,
   - deterministic recorded/mock adapter,
   - token/credit budget handling,
   - batching,
   - caching,
   - refresh policies,
   - retries,
   - partial data semantics.
3. Store normalized useful observations, not only opaque raw JSON.
4. Raw provider evidence, if retained, must be private, redacted where required,
   retention-bounded, and referenced by ID.
5. Add a history refresh job for a bounded list of ASINs.
6. Add provider status/settings UI.
7. If no live API key exists, complete the entire boundary and fixtures without
   pretending a live call succeeded.

Acceptance criteria:
- A product can display current + historical normalized metrics with provenance.
- Historical data is not required for existing wholesale scans unless policy says so.
- Provider quota/throttle states are visible.
- Tests cover missing fields and sparse histories.

======================================================================
PROMPT 05 — HISTORY ANALYTICS: PRICE STABILITY, SEASONALITY, BSR + COMPETITION
======================================================================

Using normalized market history, build deterministic historical analytics.

Goal:
Turn raw history into explainable research metrics.

Implement versioned calculations for:
- 30/90/180/365-day price median/mean where supported,
- conservative price percentile,
- price volatility,
- max drawdown / frequent price-drop signals,
- BSR median/trend/volatility,
- offer-count trend,
- Amazon Retail presence percentage,
- review-count growth,
- estimated listing age,
- seasonal index,
- trend slope,
- data coverage/completeness,
- anomaly/fad warnings.

Rules:
- Do not infer precise sales solely from BSR in this phase.
- Every metric must state the observation window and coverage.
- Sparse data produces low confidence/insufficient data, not a clean score.
- Use deterministic math and unit tests.
- Add reusable charts/components with clear source and window labels.
- Add a product History tab to the evidence/detail experience.

Acceptance criteria:
- Same input history always produces same metrics.
- Missing months do not silently become zero.
- Seasonality and trend have confidence/coverage.
- Product UI clearly separates raw history from derived metrics.

======================================================================
PROMPT 06 — PRODUCT DATABASE / "BLACK BOX"-STYLE PRODUCT EXPLORER
======================================================================

Build RizPoint Product Explorer: a powerful product-discovery screen backed only
by data currently licensed/available to the system.

Goal:
Let the user discover potentially attractive Amazon products with advanced filters.

Design a server-side query/filter architecture that can support:
- marketplace,
- category/subcategory,
- price,
- estimated monthly units/revenue when available,
- BSR / historical BSR,
- review count,
- review growth,
- star rating,
- product/listing age,
- offer count,
- FBA seller count,
- FBM seller count,
- Amazon Retail presence,
- brand,
- seller/brand concentration,
- size tier,
- weight/dimensions when available,
- variation count,
- seasonality,
- price stability,
- opportunity score,
- data completeness,
- estimated profit/margin with user assumptions,
- exclusions and saved presets.

Requirements:
1. Do not fake a global Amazon database if the connected providers cannot supply one.
2. Clearly display the source universe: e.g. tracked ASINs, imported ASINs,
   provider search universe, category snapshot, etc.
3. Use server-side pagination/windowing.
4. Saved views/presets should reuse existing analysis view concepts when sensible.
5. Add compare, save-to-project, watch, and export actions.
6. Add explainable metric tooltips.
7. Build responsive UI and empty states.
8. Support "Find low-review products with stable demand" type presets without
   hardcoding a proprietary black-box score.

Acceptance criteria:
- Filters correspond to real stored or licensed metrics.
- Product counts are honest about the searched universe.
- Query performance is acceptable on large fixtures.
- Results can be saved into ResearchProjects.

======================================================================
PROMPT 07 — CATEGORY + SUBCATEGORY INTELLIGENCE
======================================================================

Build a Category Intelligence module inspired by the useful parts of
subcategory/category research tools, but using RizPoint's own architecture.

Goal:
Help users answer:
- Which categories are growing?
- Which are dominated by a few brands?
- Where is demand stable?
- Where are review barriers lower?
- Which categories are highly seasonal?
- Which categories have attractive price bands and margins?

Create:
- category browser/tree,
- category/subcategory detail pages,
- time-window comparison,
- product-count and tracked-universe coverage,
- revenue/units estimates only when supported,
- median price,
- median reviews,
- review barrier distribution,
- brand concentration,
- seller concentration,
- Amazon Retail presence,
- new-product entry rate,
- price stability,
- seasonality,
- opportunity distribution,
- top growing/declining products/brands.

Requirements:
- Derived aggregates must cite their member universe and date.
- No market-size claim without data coverage.
- Support saving a category/subcategory to a ResearchProject or watchlist.
- Add tests for aggregate math and empty/sparse categories.

Acceptance criteria:
Category pages are useful even when some paid metrics are unavailable and state
exactly what is missing.

======================================================================
PROMPT 08 — NICHE / OPPORTUNITY FINDER
======================================================================

Build RizPoint Opportunity Finder.

Goal:
Discover niches rather than isolated products.

A niche can be defined from:
- a seed keyword,
- a keyword cluster,
- a category/subcategory subset,
- a manually selected competitor set,
- a ResearchProject market definition.

For each niche calculate, when supported:
- search demand,
- estimated units/revenue,
- median/average price,
- review barrier,
- top-10/top-20 review distribution,
- listing age distribution,
- new-entrant success,
- brand concentration,
- seller concentration,
- Amazon Retail presence,
- sponsored-result density if licensed,
- price stability,
- BSR stability,
- seasonality,
- margin potential using assumptions,
- product differentiation room,
- data completeness.

Build filterable niche discovery plus a niche detail page.

Create an explainable Opportunity Score but:
- keep component scores visible,
- store score version,
- store input references,
- never let one opaque AI prompt decide the score,
- allow threshold configuration.

Acceptance criteria:
- User can see why a niche scores well or poorly.
- Low-data niches receive low confidence.
- Score can be recalculated deterministically.

======================================================================
PROMPT 09 — SALES / DEMAND ESTIMATION WITH CONFIDENCE
======================================================================

Design and implement a defensible sales-estimation subsystem.

Goal:
Estimate monthly unit demand only where the available licensed data supports it.

Do NOT invent a universal BSR-to-sales formula.

Architecture:
- SalesEstimateProvider for licensed direct estimates if available.
- Deterministic internal estimator as an OPTIONAL fallback only when calibrated
  against a real reference dataset.
- Marketplace + category-specific calibration.
- Confidence intervals/ranges rather than false precision.
- Model versioning and backtesting.
- Separate "provider estimated sales" from "RizPoint modeled sales."

Inputs may include, where lawful/licensed:
- sales rank history,
- category,
- price,
- offer history,
- review velocity,
- provider-supplied sales estimates,
- observed account sales for calibration.

Build:
- estimation service,
- model registry/version,
- confidence/coverage,
- evaluation metrics,
- backtest fixtures,
- UI displaying range and source.

Acceptance criteria:
- No estimate without provenance/model version.
- UI never presents an uncalibrated heuristic as exact sales.
- Tests include high/low rank, sparse history, category mismatch, and no-data cases.

======================================================================
PROMPT 10 — KEYWORD INTELLIGENCE CORE + KEYWORD EXPLORER
======================================================================

Build the keyword-research foundation.

Goal:
Support seed-keyword discovery using an authorized/licensed
KeywordIntelligenceProvider.

Normalized keyword metrics should support, where the provider supplies them:
- search volume,
- search-volume history,
- trend,
- seasonality,
- suggested related terms,
- competing product count,
- sponsored density,
- CPC/bid estimates,
- title density,
- conversion/click/share metrics from first-party sources when authorized,
- keyword relevancy,
- dominant ASINs,
- provider/source,
- observed_at,
- confidence/completeness.

Create Keyword Explorer:
- seed search,
- filters,
- sorting,
- include/exclude word filters,
- stemming/normalization,
- save to keyword list/project,
- batch add,
- export,
- history chart,
- related keyword clusters.

If no licensed keyword provider is configured:
implement contracts, fixtures, settings and honest disabled/partial UI.

Acceptance criteria:
- Keyword metrics from different providers remain distinguishable.
- Search volume is never fabricated.
- Keyword normalization does not destroy the original phrase.

======================================================================
PROMPT 11 — REVERSE ASIN + COMPETITOR KEYWORD GAP
======================================================================

Build a reverse-ASIN keyword workflow similar in usefulness to modern
competitor keyword tools, but vendor-neutral.

Goal:
Given 1-10 ASINs, show keywords associated with them where licensed data supports:
- organic rank,
- sponsored rank,
- recommendation/relevancy state,
- search volume,
- trend,
- competing ASIN overlap,
- ranking ASIN count,
- average/median rank,
- competitor gap.

Features:
- single-ASIN reverse lookup,
- multi-ASIN intersection,
- "all competitors rank; my ASIN does not" gap,
- "my ASIN ranks but competitors do not",
- keyword opportunity filtering,
- search-volume weighted gap score,
- export/save to project,
- keyword-to-product matrix.

Rules:
- Sponsored/organic position must retain observation time.
- No rank data should be inferred from Amazon HTML scraping.
- Add provider entitlement state.

Acceptance criteria:
- Matrix handles missing ASIN observations correctly.
- Gap metrics are deterministic and explainable.

======================================================================
PROMPT 12 — AMAZON BRAND ANALYTICS / SQP FIRST-PARTY DATA
======================================================================

Add an official Amazon first-party keyword analytics adapter for connected
accounts where the seller/brand is actually eligible.

Goal:
Use authorized Amazon Brand Analytics / Search Query Performance data when
available through current supported Amazon reports/APIs.

Implement behind a provider interface:
- report/request orchestration,
- asynchronous job state,
- marketplace/account/brand eligibility,
- date-range handling,
- normalized query metrics,
- click share,
- conversion/purchase share or other officially available metrics,
- ASIN/query relationships,
- storage and freshness.

Important:
- Do not assume every seller has Brand Analytics.
- Do not build undocumented endpoints.
- If current official access does not expose a metric, mark unsupported.
- Do not conflate provider keyword estimates with first-party Amazon data.

UI:
- "First-party Amazon" badge,
- SQP/ABA views,
- compare Amazon first-party metrics against licensed keyword estimates,
- warnings on incompatible date windows.

Acceptance criteria:
- Unauthorized/ineligible accounts degrade cleanly.
- Tests use recorded/redacted fixtures only.
- First-party data is clearly distinguished from estimates.

======================================================================
PROMPT 13 — KEYWORD RANK TRACKER + SEARCH SHARE-OF-VOICE
======================================================================

Build scheduled keyword rank monitoring.

Goal:
Track selected ASINs against selected keywords over time.

Support:
- organic rank,
- sponsored rank if provider supports it,
- page/position,
- timestamp,
- marketplace,
- observed search context/provider,
- daily/weekly scheduling,
- rank change,
- moving average,
- best/worst rank,
- volatility,
- share-of-voice across a competitor set,
- alerts for material changes.

Requirements:
- Use SearchRankProvider, not page scraping.
- Batch requests and obey quotas.
- Let users choose tracking cadence.
- Add job deduplication.
- Create compact trend charts and comparison tables.
- Integrate with ResearchProject and product detail.

Acceptance criteria:
- Scheduler is idempotent.
- Quota exhaustion does not delete/zero prior observations.
- History supports multiple ASINs per keyword.

======================================================================
PROMPT 14 — PRODUCT TRACKER + MARKET TRACKER
======================================================================

Build persistent product/market monitoring.

Goal:
Allow users to create a market from ASINs/keywords/category criteria and monitor:
- estimated units,
- estimated revenue,
- price,
- BSR,
- reviews,
- rating,
- offer count,
- Amazon Retail presence,
- seller/brand share,
- new entrants,
- exits,
- stock/availability signal when licensed,
- opportunity score changes.

Views:
1. Product Tracker
2. Market Tracker
3. Market Timeline
4. Entrants/Exits
5. Share table
6. Change feed

Requirements:
- Every roll-up names its market membership and window.
- Market membership can be frozen or dynamic by explicit mode.
- Add daily/weekly snapshots based on user cadence.
- Avoid runaway provider costs; show estimated request/credit impact.
- Add alert hooks but implement full alerts later.

Acceptance criteria:
- A historical market can be replayed for prior dates when data exists.
- New entrant detection has explicit rules.
- Market metrics do not mix incompatible provider windows silently.

======================================================================
PROMPT 15 — BRAND INTELLIGENCE
======================================================================

Build a Brand Intelligence module.

Goal:
Research Amazon brands as economic/competitive entities.

For each brand, where data supports:
- ASIN count in known universe,
- categories/subcategories,
- estimated sales/revenue,
- median price,
- median reviews,
- rating distribution,
- new products,
- growth/decline,
- market share within tracked markets,
- Amazon Retail relationship/presence where relevant,
- seller distribution,
- product concentration,
- keyword footprint,
- sponsored visibility if licensed,
- historical trend.

Features:
- brand search,
- brand detail,
- compare brands,
- save/watch,
- top products,
- category mix,
- growth chart,
- concentration risk,
- new launch detection.

Do not infer brand ownership from seller name unless source data actually supports it.

Acceptance criteria:
- Brand entity resolution has confidence/provenance.
- Aggregates state coverage universe.

======================================================================
PROMPT 16 — SELLER + COMPETITOR INTELLIGENCE
======================================================================

Build Seller Intelligence and Competitor Explorer.

Goal:
Research seller activity where the selected licensed data source and terms permit it.

Potential fields:
- seller identity/provider ID,
- known product count,
- category mix,
- brand mix,
- estimated revenue/units if licensed,
- fulfillment mix,
- offer count,
- pricing behavior,
- geographic/business metadata only when legally/licensed and non-sensitive,
- growth trend,
- new products,
- market overlap with selected projects.

Features:
- seller search,
- seller detail,
- overlap with my research market,
- compare sellers,
- seller-to-brand relationships with confidence,
- "find sellers carrying this ASIN/brand" if licensed.

Rules:
- No scraping seller storefronts as core production strategy.
- No personal data enrichment beyond legitimate business/provider data.
- All estimated economic metrics need source/coverage.

Acceptance criteria:
- Seller data is optional and entitlement-gated.
- Missing provider data does not break product research.

======================================================================
PROMPT 17 — PRODUCT RELATIONSHIP / TRAFFIC GRAPH
======================================================================

Build a product-relationship graph only from authorized/licensed relationship data.

Goal:
Visualize useful relationships such as:
- frequently bought together,
- also viewed,
- related/recommended,
- shared keyword cluster,
- shared market,
- co-ranking,
- variant/family relationships.

Architecture:
- ProductRelationshipProvider
- typed relationship types
- strength/confidence
- observed_at
- source
- graph storage/query strategy

UI:
- interactive neighborhood graph,
- list/table alternative for accessibility,
- filters by relationship type,
- "expand node",
- save related ASINs to project,
- identify adjacent product opportunities.

If direct Amazon behavioral relationship data is unavailable, build only
relationships legitimately derivable from the data we possess, such as shared
keyword or shared-market similarity. Label those as derived.

Acceptance criteria:
- Relationship type/source is always visible.
- Derived similarity is not mislabeled as Amazon customer behavior.

======================================================================
PROMPT 18 — ADVERTISING / SPONSORED INTELLIGENCE PROVIDER
======================================================================

Create an optional AdvertisingIntelligence module.

Goal:
Support competitor sponsored-search visibility and advertising research ONLY
when a licensed provider or authorized first-party data source exposes it.

Possible normalized metrics:
- sponsored keyword position,
- sponsored visibility frequency,
- sponsored ASIN,
- advertiser/product,
- observed_at,
- keyword,
- marketplace,
- share-of-voice,
- CPC/bid ranges when licensed.

Build:
- AdvertisingIntelligenceProvider
- fixtures
- keyword/ASIN ad visibility views
- competitor ad overlap
- high-paid-visibility keyword report
- market sponsored-density metric

Do not reverse engineer or scrape sponsored placements from Amazon HTML.

Acceptance criteria:
- Entire feature is capability-gated.
- Without a provider it shows configuration guidance, not fake data.

======================================================================
PROMPT 19 — REVIEW INTELLIGENCE + CUSTOMER PAIN-POINT MINING
======================================================================

Build Review Intelligence with a strict lawful-data boundary.

Goal:
Turn review data the user is authorized/licensed to access into product insights.

Input sources may include:
- licensed review provider,
- user-imported review exports,
- other explicitly authorized sources.

Do NOT build Amazon review-page scraping.

Pipeline:
1. Ingest review records with source/time/rating.
2. Deduplicate.
3. Normalize language.
4. Cluster recurring themes.
5. Identify:
   - complaints,
   - praised attributes,
   - quality problems,
   - sizing/compatibility issues,
   - packaging issues,
   - missing features,
   - durability issues,
   - confusion/instructions,
   - sentiment by theme,
   - rating by theme,
   - trend over time.
6. AI may classify/summarize text, but retain review IDs/evidence references.
7. Every summary must link back to supporting source records.
8. Add "What customers want improved" report.
9. Compare pain points across top competitors.

Acceptance criteria:
- No unsupported AI claim without linked evidence.
- Personally identifying review information is minimized/redacted as appropriate.
- User can inspect source examples behind a theme.

======================================================================
PROMPT 20 — PRODUCT GAP + DIFFERENTIATION ENGINE
======================================================================

Build a Product Differentiation workspace that combines structured market data
with review intelligence.

Goal:
Help answer "If we launch into this niche, what can we do better?"

Inputs:
- top competitor attributes,
- titles/bullets/structured product metadata from licensed/authorized sources,
- review pain points,
- price bands,
- variation patterns,
- rating/review distribution,
- feature frequency,
- keyword intent,
- return/compliance flags if available.

Outputs:
- unmet needs,
- over-served features,
- common complaints,
- feature white space,
- bundle opportunities,
- size/color/material gaps,
- packaging opportunities,
- instruction/usability opportunities,
- price-positioning opportunities,
- high-risk differentiation ideas,
- recommended validation questions for suppliers.

AI can propose ideas, but:
- label them as hypotheses,
- cite underlying evidence,
- do not make medical/safety/legal claims,
- do not recommend patent/trademark infringement.

Create a "Differentiation Brief" exportable to a ResearchProject.

Acceptance criteria:
- Evidence vs hypothesis is visually distinct.
- Every recommendation lists supporting signals and confidence.

======================================================================
PROMPT 21 — LISTING ANALYZER
======================================================================

Build a Listing Analyzer for a selected ASIN or draft listing.

Goal:
Provide an explainable optimization checklist.

Analyze, where data is authorized:
- title structure/length,
- bullet completeness,
- image-count metadata,
- A+ presence if known,
- category-required attributes,
- keyword coverage,
- competitor keyword gaps,
- duplicate/redundant language,
- readability,
- benefit/feature balance,
- compliance-risk language,
- variation structure,
- review themes not addressed in copy.

Do not claim Amazon ranking causality without evidence.

Create:
- overall listing quality assessment,
- component scores with explicit rules,
- keyword coverage table,
- competitor comparison,
- prioritized action list.

Rules:
- Deterministic checklist rules first.
- AI can suggest copy/interpretation but cannot fabricate product claims.

Acceptance criteria:
- Score is decomposable.
- Draft vs current listing can be compared.
- Warnings distinguish SEO opportunity from compliance risk.

======================================================================
PROMPT 22 — AI LISTING BUILDER / LISTING ARCHITECT
======================================================================

Build a Listing Builder connected to ResearchProjects.

Inputs:
- verified product facts supplied by the user,
- target marketplace,
- target keyword list,
- keyword priority,
- differentiation brief,
- brand voice,
- competitor gaps,
- prohibited claims/terms,
- category constraints.

Generate editable:
- title,
- bullets,
- description,
- backend search-term suggestions,
- image brief,
- A+ content outline,
- FAQ ideas.

Hard rules:
- Never invent specifications, certifications, materials, dimensions, guarantees,
  health claims, compatibility, origin, or performance.
- Every factual claim must come from a verified ProductFact record or user input.
- Keep a claim/evidence map.
- Highlight unverified phrases before export.
- Keyword stuffing warnings.
- Version every draft.

Acceptance criteria:
- User can see which facts/keywords each generated section used.
- Unverified factual claims block "approved" state.

======================================================================
PROMPT 23 — PRIVATE-LABEL LAUNCH PLANNER
======================================================================

Build a Launch Planner that turns a validated ResearchProject into an execution plan.

Goal:
Create a stage-gated launch workspace, not a generic todo list.

Stages:
- niche approved,
- supplier/sample,
- compliance validation,
- final cost,
- brand/trademark readiness,
- packaging/artwork,
- listing assets,
- keyword plan,
- inventory/order,
- shipment/FBA,
- launch date,
- advertising setup,
- rank/market monitoring,
- review/returns learning loop.

Include:
- dependencies,
- owner,
- due date,
- status,
- evidence links,
- budget,
- target KPIs,
- launch assumptions,
- risks,
- change log.

Research-derived launch outputs:
- target keywords,
- competitor set,
- target price band,
- break-even PPC assumptions,
- minimum acceptable margin,
- monitoring watchlist.

Do not automate external purchases or Seller Central writes in this phase.

Acceptance criteria:
- Launch plan is linked to the exact research evidence/version used to approve it.

======================================================================
PROMPT 24 — PRIVATE-LABEL PROFITABILITY + SUPPLIER QUOTE SCENARIOS
======================================================================

Extend the deterministic financial engine for private-label sourcing while
preserving wholesale calculations.

Goal:
Compare multiple supplier quote/manufacturing scenarios.

Support:
- EXW/FOB/DDP style quote assumptions,
- unit cost,
- MOQ,
- samples,
- tooling/mold/setup,
- packaging,
- labeling,
- inspection,
- freight,
- customs/duties/tariffs,
- insurance,
- prep,
- inbound placement/shipping,
- Amazon referral/FBA fees,
- storage allowance,
- returns allowance,
- ad launch budget allocation,
- coupon/promo assumptions,
- expected defect allowance,
- target selling prices.

Calculations:
- landed cost/unit,
- contribution margin,
- net profit/unit,
- ROI,
- margin,
- break-even sale price,
- break-even ad spend / ACoS style thresholds where mathematically defined,
- initial cash required,
- MOQ cash exposure,
- scenario comparison,
- stress tests.

Requirements:
- Decimal/NUMERIC only.
- Formula versioning.
- Every cost has source/assumption date.
- Explicit currency conversion observations.
- Do not bury uncertain costs.

UI:
supplier quote comparison table + waterfall + sensitivity analysis.

Acceptance criteria:
- Existing wholesale formulas remain stable.
- Manually audited examples reconcile to the cent.

======================================================================
PROMPT 25 — PRODUCT COMPLIANCE / CERTIFICATION RISK SCREEN
======================================================================

Build a research-stage compliance-risk screen.

Goal:
Help users avoid product ideas that may require complex approvals/certifications,
without pretending the software provides legal advice.

Create structured risk domains:
- ingestible/food/supplement,
- cosmetic/topical,
- medical/health claims,
- children's product,
- battery,
- radio/wireless,
- electrical/mains,
- laser,
- PPE/safety,
- chemical/hazardous material,
- flammable/aerosol,
- automotive safety,
- pet consumable,
- textile/apparel labeling,
- country-of-origin/labeling,
- IP/trademark/patent risk prompts,
- Amazon restricted-category/restriction status.

Output:
- LOW / REVIEW / HIGH / UNKNOWN,
- why,
- evidence/source,
- questions to ask supplier,
- documentation likely to verify,
- "do not launch until verified" flags.

Rules:
- Do not invent legal requirements.
- Make jurisdiction and marketplace explicit.
- Use curated rules with source/version and allow admin updates.
- AI can classify a product into risk domains but cannot be authoritative.

Acceptance criteria:
- UNKNOWN remains unknown.
- User can see date/source/version of a rule.
- The tool never says "no certification required" unless an authoritative rule
  truly supports that conclusion.

======================================================================
PROMPT 26 — PORTFOLIO / CASH ALLOCATION OPTIMIZER
======================================================================

Build an explainable portfolio selection engine.

Goal:
Given a list of candidate products and a cash budget, recommend a portfolio
under explicit constraints.

Inputs:
- cash budget,
- MOQ/case constraints,
- max exposure per ASIN/brand/category,
- expected monthly demand range,
- lead time,
- margin/ROI,
- confidence,
- seasonality,
- compliance risk,
- price volatility,
- competition risk,
- target inventory days.

Outputs:
- recommended allocation,
- expected profit range,
- cash used,
- diversification,
- risk concentration,
- excluded products and reason,
- alternative portfolios.

Use deterministic optimization (linear/integer programming or clearly justified
algorithm), NOT an LLM.

Include scenario/stress modes:
- base,
- demand -20%,
- price -10%,
- fee +5%,
- delayed replenishment,
- ad cost increase.

Acceptance criteria:
- Same inputs produce same portfolio.
- Constraints are auditable.
- Solver failure has a safe fallback/error state.

======================================================================
PROMPT 27 — RESEARCH PROJECTS, BOARDS, COMPARISON + DECISION MEMOS
======================================================================

Turn ResearchProject into the central workflow hub.

Goal:
A user should be able to move from raw idea to evidence-backed launch decision.

Add:
- project dashboard,
- candidate products,
- candidate niches,
- keyword lists,
- competitor set,
- saved brands/sellers,
- notes,
- tags,
- statuses,
- attachments/evidence references,
- assumptions,
- scores,
- supplier quotes,
- compliance checks,
- differentiation brief,
- listing drafts,
- launch plan,
- watchlist.

Build comparison tools:
- compare up to 10 products,
- compare niches,
- normalized side-by-side metrics,
- "why A beats B" deterministic reason summary,
- AI narrative only as an explanation layer.

Create Decision Memo:
- thesis,
- evidence,
- economics,
- demand,
- competition,
- risks,
- unresolved questions,
- go/no-go decision,
- decision owner/date,
- source snapshot IDs.

Acceptance criteria:
- A decision can be replayed later from stored evidence.
- Updated data does not rewrite the historical memo.

======================================================================
PROMPT 28 — BROWSER EXTENSION / AMAZON RESEARCH COMPANION
======================================================================

Build a Chrome/Chromium extension as a separate package/app in the monorepo.

Goal:
While the user is viewing an Amazon product/search page, make it easy to send
research targets into RizPoint.

STRICT DATA RULE:
Do not make HTML scraping the data engine.
The extension may safely read the current URL and extract identifiers such as
an ASIN from the URL/page context where practical, then request authorized
backend enrichment through RizPoint providers.

Features:
- detect marketplace/domain,
- detect ASIN from URL,
- "Analyze in RizPoint",
- "Save to Project",
- "Add to Watchlist",
- compact side panel showing backend-returned:
  price/history,
  estimated demand,
  reviews,
  competition,
  profitability assumptions,
  opportunity score,
  alerts,
  keyword links,
  compliance risk.
- multi-select/send ASINs only if reliable without prohibited scraping.
- authentication with short-lived backend session/token.
- no provider secrets in extension.
- clear offline/provider-error state.

Acceptance criteria:
- Extension is useful even if it only sends ASIN/URL initially.
- All rich metrics come from RizPoint backend/provider APIs.
- Minimal permissions.
- Security review completed.

======================================================================
PROMPT 29 — AI RESEARCH COPILOT OVER VERIFIED INTERNAL DATA
======================================================================

Build an AI Research Copilot that answers natural-language questions using
RizPoint's stored evidence.

Example questions:
- "Find niches with stable demand, price above $20, median reviews under 300,
   and low brand concentration."
- "Why did this opportunity score fall this week?"
- "Compare these 5 products and tell me the biggest risk."
- "Which competitor complaints appear most often?"
- "What assumptions could reverse this BUY/GO decision?"
- "Show products where Amazon Retail entered recently."

Architecture:
- tool/function based retrieval, not unrestricted SQL from model output;
- allowlisted query operations;
- tenant-scoped;
- evidence citations/IDs in answers;
- bounded row counts;
- no secrets/raw provider payload exposure;
- conversation/session persistence optional.

Rules:
- AI never performs authoritative financial math.
- AI should call deterministic calculation/query services.
- Answers distinguish fact, derived metric, and hypothesis.
- If data is missing, say so.
- Add prompt-injection defenses for imported supplier/review text.

Acceptance criteria:
- Every factual answer can link to internal evidence.
- Cross-tenant data access has tests.
- The model cannot invoke arbitrary database mutations.

======================================================================
PROMPT 30 — ALERTS, WATCHES + CHANGE DETECTION
======================================================================

Build a robust Monitoring & Alerts system.

Allow alert rules for:
- price below/above threshold,
- BSR change,
- estimated demand change,
- review-count growth spike,
- rating decline,
- offer-count change,
- Amazon Retail enters/exits,
- new competitor enters market,
- keyword rank gain/loss,
- keyword search volume trend,
- opportunity score change,
- margin falls below threshold,
- provider data stale,
- tracked product out-of-stock signal when supported,
- compliance/restriction status change.

Requirements:
- scheduled evaluator jobs,
- idempotent events,
- cooldown/deduplication,
- severity,
- evidence snapshot,
- read/unread/acknowledged,
- in-app notification center.
- Email/webhook can remain provider-gated/later if not configured.

Acceptance criteria:
- No repeated alert spam for unchanged state.
- Every alert includes trigger inputs and observed_at.
- Alert evaluation never treats missing provider data as zero.

======================================================================
PROMPT 31 — MULTI-MARKETPLACE RESEARCH
======================================================================

Generalize research modules beyond Amazon.com without weakening the US workflow.

Goal:
Support marketplace-aware research for Amazon marketplaces where providers
legitimately support the required data.

Requirements:
- marketplace registry,
- locale/language/currency/timezone,
- category mapping differences,
- fee model differences,
- provider capability matrix per marketplace,
- currency FX observation/source/time,
- keyword language handling,
- no cross-market metric comparisons without normalization,
- marketplace-specific historical/sales model versions,
- saved user default marketplace.

UI:
- marketplace switcher,
- compare same ASIN/product across markets where identifiers/relationships support it,
- unsupported feature indicators.

Acceptance criteria:
- US existing calculations unchanged.
- Provider capabilities can differ by marketplace cleanly.

======================================================================
PROMPT 32 — NEXT-LEVEL UI/UX INFORMATION ARCHITECTURE
======================================================================

Perform a cohesive UI/UX upgrade for the expanded research platform.

Goal:
Make the tool feel like a professional research OS, not a collection of dev screens.

Proposed top navigation:
- Dashboard
- Wholesale
- Product Research
- Niches
- Keywords
- Markets
- Brands & Sellers
- Projects
- Monitoring
- Launch
- Settings

Design principles:
- dense but readable data,
- keyboard-friendly,
- responsive,
- consistent metric formatting,
- reusable filters,
- saved views,
- compare trays,
- evidence drawers,
- date-window controls,
- provider/source badges,
- data freshness indicators,
- partial/stale/unsupported states,
- chart/table toggle where valuable,
- accessible color-independent status cues.

Create a reusable design system based on the current styling rather than
blindly replacing everything.

Important:
- Do not sacrifice the wholesale workflow.
- Avoid giant one-file React workspaces.
- Break feature UI into domain components/hooks/query modules.

Acceptance criteria:
- Core workflows usable at desktop widths and sensible on tablet/mobile.
- Accessibility tests.
- No metric shown without source/window context when that matters.

======================================================================
PROMPT 33 — PERFORMANCE, SCHEDULING, CACHE + LARGE-SCALE DATA ENGINEERING
======================================================================

Harden the platform for large research datasets and scheduled history collection.

Goal:
Support large-scale product/keyword/time-series research without turning every
page load into provider calls.

Inspect real query patterns and implement only justified changes:
- indexed/partitioned history tables,
- aggregation/materialized views where useful,
- background refresh queues,
- request coalescing,
- provider result cache,
- stale-while-refresh semantics,
- batching,
- bounded concurrency,
- rate budgets,
- pagination/windowing,
- query timeout protection,
- export jobs,
- retention/downsampling policies,
- job priority classes.

Benchmark fixtures:
- 100k products,
- 1M observations,
- 5M keyword-product observations,
or a realistic scaled equivalent.

Do not introduce a new database technology merely because it is fashionable.
If recommending TimescaleDB/ClickHouse/warehouse tech, first prove why current
Postgres architecture cannot meet the measured requirement.

Acceptance criteria:
- Performance tests and documented baselines.
- No N+1 provider calls.
- UI does not block on large refresh jobs.

======================================================================
PROMPT 34 — SECURITY, PRIVACY, LICENSING + PROVIDER-COMPLIANCE AUDIT
======================================================================

Perform a deep security/data-rights hardening pass for the expanded platform.

Audit:
- auth/session,
- tenant isolation,
- provider credentials,
- extension auth,
- object storage,
- raw evidence,
- logs,
- exports,
- imported reviews/files,
- prompt injection,
- SSRF,
- file uploads,
- spreadsheet injection,
- rate-limit abuse,
- background jobs,
- IDOR,
- cross-project access,
- data retention,
- deletion,
- secret scanning.

Provider/legal architecture:
- store provider entitlement metadata,
- store terms/data-retention constraints where operationally necessary,
- make features capability-gated,
- disable exports of fields whose provider license forbids redistribution,
- distinguish internal-use vs redistributable metrics.

Create/update:
- threat model,
- data classification,
- provider data-rights matrix,
- security tests,
- privacy/retention docs.

Acceptance criteria:
- No live credentials in browser/build output.
- Cross-tenant security tests.
- Extension uses minimum permissions.
- Provider-specific export restrictions can be enforced.

======================================================================
PROMPT 35 — GOLDEN DATASETS, EVALS + RESEARCH ACCURACY BENCHMARK
======================================================================

Create a formal evaluation system for the new research platform.

Goal:
Measure whether the tool is actually trustworthy.

Build redacted/synthetic golden datasets for:
- product history calculations,
- seasonality,
- opportunity scoring,
- niche aggregation,
- category aggregation,
- keyword normalization,
- reverse-ASIN gap math,
- rank tracking,
- sales estimates,
- review clustering,
- differentiation summaries,
- profitability,
- compliance classification,
- portfolio optimization.

For AI features:
- create evaluation cases with expected evidence grounding,
- hallucination checks,
- missing-data behavior,
- unsafe claim tests,
- prompt-injection cases.

For provider adapters:
- recorded/redacted contract fixtures,
- schema-drift tests,
- throttling,
- partial payloads,
- entitlement failure.

Create a single documented release-gate command or CI group.

Acceptance criteria:
- A research metric cannot silently change formula without version/test changes.
- AI summaries fail tests when unsupported by evidence.
- Sales-estimation quality is measured, not asserted.

======================================================================
PROMPT 36 — FINAL INTEGRATION + "NEXT-LEVEL" RELEASE AUDIT
======================================================================

Perform a read-only first, then fix-in-scope final release audit of the entire
RizPoint platform after Prompts 00-35 have been completed.

Goal:
Determine whether the system is a coherent, trustworthy Amazon research OS.

Audit these end-to-end journeys:

WHOLESALE
supplier sheet -> mapping -> match -> PackGuard -> Amazon evidence -> profit
-> shortlist -> PO -> export

PRIVATE LABEL PRODUCT DISCOVERY
category/keyword -> product discovery -> history -> demand -> competition
-> niche score -> project -> supplier quote -> compliance -> decision memo

KEYWORD
seed keyword -> keyword discovery -> reverse ASIN -> gap analysis -> tracking
-> listing builder

MARKET
competitor set -> market definition -> daily snapshots -> entrants/exits
-> share/trends -> alerts

LAUNCH
approved project -> differentiation -> listing -> economics -> launch planner
-> monitoring

EXTENSION
Amazon URL/ASIN -> backend analysis -> save project/watch

COPILOT
natural-language question -> tenant-safe deterministic retrieval -> evidence-backed answer

Audit against public feature families of modern Amazon research tools, but do
not add features just to match a competitor checklist. Prioritize accuracy,
evidence, differentiation, and user workflow.

Fix:
- broken integration points,
- inconsistent navigation,
- duplicate domain logic,
- missing tests,
- missing source labels,
- misleading empty/partial states,
- accessibility regressions,
- obvious performance regressions.

Create:
docs/NEXT_LEVEL_RELEASE_AUDIT.md

It must contain:
- implemented capabilities,
- incomplete capabilities,
- live provider dependencies,
- measured test/benchmark status,
- known accuracy limits,
- production risks,
- recommended 90-day roadmap.

Acceptance criteria:
- No "production-ready" claim without live-provider and real-user validation.
- Existing wholesale release gates still pass.
- Research release gates pass.
- All external-data limitations are documented.

======================================================================
OPTIONAL PROMPT 37 — COMMERCIAL SAAS CONVERSION
======================================================================

ONLY RUN THIS AFTER THE PRIVATE TOOL IS RELIABLE ON REAL DATA.

Convert the private research platform into a commercial multi-tenant SaaS.

Implement in bounded slices:
- organization onboarding,
- role-based access,
- secure Amazon authorization per org,
- provider entitlements/plans,
- usage metering,
- quotas,
- billing abstraction,
- subscription plan,
- plan-gated features,
- team invites,
- admin/support tooling,
- deletion/export requests,
- privacy/legal pages,
- audit events,
- per-tenant provider-cost accounting,
- onboarding checklist,
- tenant-aware background scheduling.

Do not weaken tenant isolation.
Do not expose licensed provider data in ways prohibited by provider terms.
Do not start with multiple complicated pricing tiers; implement a simple plan
model that can evolve.

Release gate:
At least 10 external pilot users complete:
onboarding -> research -> project -> decision/export
without manual database intervention and without cross-tenant/security incidents.

======================================================================
OPTIONAL PROMPT 38 — FINAL PRODUCT DIFFERENTIATORS
======================================================================

After the core platform is accurate, design and implement 3-5 uniquely RizPoint
features that make the product meaningfully better rather than merely equivalent.

Evaluate these candidates:

1. Evidence-First Opportunity Score
   Every opportunity component is clickable back to its exact observations.

2. "What Could Reverse This Decision?"
   Automatically run sensitivity analysis to identify the smallest plausible
   change in price, demand, ad cost, fees, competition, or landed cost that
   flips GO -> NO-GO.

3. New-Entrant Success Analyzer
   Identify recent listings in a niche and compare which characteristics
   correlate with traction, with careful non-causal language.

4. Supplier-to-Market Bridge
   Take an Alibaba/manufacturer quote or a wholesale supplier row and immediately
   compare it against the market research project, history, keyword demand,
   competition, compliance risk, and unit economics.

5. Evidence-Backed Product Brief
   Produce one export/report containing:
   market,
   keywords,
   competitors,
   customer pain points,
   differentiation,
   supplier requirements,
   target price/cost,
   compliance questions,
   launch assumptions,
   and risk triggers.

6. Decision Replay
   Open any historical GO/BUY decision and see what data changed since then.

7. Opportunity Change Feed
   "These 7 researched niches became more attractive this month because reviews,
   competition, price stability, or demand changed."

Choose only differentiators that can be supported by real data and the existing
architecture. Implement them one at a time with separate acceptance tests.

======================================================================
RECOMMENDED FEATURE CHECKLIST AFTER THE FULL PACK
======================================================================

The final product should ideally include:

CORE WHOLESALE
[ ] Supplier catalog upload/mapping
[ ] Pack-aware matching
[ ] Amazon evidence
[ ] Eligibility/restrictions
[ ] Profit calculations
[ ] Shortlists
[ ] Purchase orders
[ ] Exports

PRODUCT RESEARCH
[ ] Product Explorer
[ ] Advanced filters/presets
[ ] Product history
[ ] Product comparison
[ ] Product tracker
[ ] Opportunity scoring
[ ] Sales/demand estimates with confidence
[ ] Trend/seasonality analysis

NICHE/CATEGORY
[ ] Category Explorer
[ ] Subcategory intelligence
[ ] Opportunity Finder
[ ] Niche comparison
[ ] Market concentration
[ ] New-entrant analysis

KEYWORDS
[ ] Keyword Explorer
[ ] Seed expansion
[ ] Reverse ASIN
[ ] Multi-ASIN keyword intersection
[ ] Keyword gap analysis
[ ] Keyword history
[ ] Rank tracker
[ ] Search share-of-voice
[ ] First-party ABA/SQP when eligible

COMPETITIVE INTELLIGENCE
[ ] Brand intelligence
[ ] Seller intelligence
[ ] Competitor comparison
[ ] Market Tracker
[ ] Entrants/exits
[ ] Product relationship graph
[ ] Optional licensed sponsored/ad intelligence

CUSTOMER / DIFFERENTIATION
[ ] Review ingestion from authorized sources
[ ] Theme clustering
[ ] Pain-point mining
[ ] Competitor complaint comparison
[ ] Product gap analysis
[ ] Differentiation brief

LISTING / LAUNCH
[ ] Listing Analyzer
[ ] Keyword coverage
[ ] AI Listing Builder with fact grounding
[ ] Launch Planner
[ ] Research-to-launch handoff
[ ] Monitoring after launch

FINANCIAL / RISK
[ ] Private-label supplier quote comparison
[ ] Landed cost
[ ] Profit / ROI / margin
[ ] Sensitivity/stress tests
[ ] Cash allocation optimizer
[ ] Compliance/certification risk screen

WORKFLOW
[ ] Research Projects
[ ] Notes/tags/status
[ ] Decision memos
[ ] Watchlists
[ ] Alerts
[ ] Change feed
[ ] Evidence replay
[ ] Exports

EXPERIENCE
[ ] Browser extension
[ ] AI Research Copilot
[ ] Source/freshness badges
[ ] Responsive UI
[ ] Accessibility
[ ] Saved views
[ ] Multi-marketplace support

PLATFORM
[ ] Licensed provider abstractions
[ ] Quota/rate-budget management
[ ] Caching
[ ] Scheduled refresh
[ ] Time-series performance
[ ] Security
[ ] Provider-license enforcement
[ ] Golden datasets/evals
[ ] CI release gates
[ ] Observability
[ ] Backup/recovery

======================================================================
IMPORTANT IMPLEMENTATION ORDER
======================================================================

Do not jump directly to AI or the browser extension.

Recommended order:

FOUNDATION
00 -> 01 -> 02 -> 03

DATA TRUTH
04 -> 05

DISCOVERY
06 -> 07 -> 08 -> 09

KEYWORDS
10 -> 11 -> 12 -> 13

MARKET / COMPETITION
14 -> 15 -> 16 -> 17 -> 18

CUSTOMER / DIFFERENTIATION
19 -> 20

LISTING / LAUNCH
21 -> 22 -> 23

ECONOMICS / RISK / PORTFOLIO
24 -> 25 -> 26

WORKFLOW / EXPERIENCE
27 -> 28 -> 29 -> 30 -> 31 -> 32

HARDENING
33 -> 34 -> 35 -> 36

OPTIONAL COMMERCIALIZATION
37

OPTIONAL DIFFERENTIATORS
38

======================================================================
WHAT NOT TO DO
======================================================================

Do NOT:
- rewrite the existing application from scratch;
- replace deterministic financial calculations with AI;
- silently convert missing market data to zero;
- treat BSR as exact sales without calibration;
- call FBA "Amazon Retail";
- assume every seller has Brand Analytics access;
- scrape Amazon HTML as the production data source;
- put provider API keys in browser code;
- add a mysterious score without component evidence;
- let AI invent certifications/product facts;
- mix marketplace currencies without dated FX observations;
- mix 30-day and 365-day metrics without labeling windows;
- build a new database just because scale might someday require it;
- create giant React files for the new research screens;
- delete or weaken PackGuard;
- weaken tenant boundaries because the app is currently private;
- copy competitor branding/UI/code/proprietary algorithms;
- claim the platform is accurate before real-provider validation.

======================================================================
DEFINITION OF "NEXT LEVEL"
======================================================================

The tool is "next level" when it can reliably answer questions like:

- What products or niches are becoming attractive right now?
- Is demand stable or seasonal?
- Is the current price normal or temporarily inflated?
- How competitive is the niche beyond just review count?
- Are a few brands controlling most of the market?
- Are newer listings successfully entering?
- Is Amazon Retail frequently competing?
- Which keywords actually matter?
- Which keywords do competitors rank for that this product does not?
- What customer complaints are repeated across competitors?
- What meaningful differentiation could we validate with a supplier?
- What selling price and landed cost make this launch worthwhile?
- What could cause this product to fail?
- What compliance/certification questions must be answered before launch?
- Which product should receive limited cash?
- What changed since we approved this opportunity?
- Can every important number and recommendation be traced to evidence?

That evidence-first approach should remain RizPoint's differentiator.

END OF PROMPT PACK
