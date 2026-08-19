# Product

RizPoint Sourcing OS is an evidence-first Amazon sourcing and market-research
platform. It supports two bounded workflows on one auditable catalog identity:

- **Wholesale sourcing** turns supplier catalogs into purchase-ready decisions.
- **Amazon market research** organizes private-label and manual/wholesale ASIN
  research into projects, explicit markets, observations, assessments, and
  watches.

Research does not manufacture supplier rows and never replaces the wholesale
workflow. Both modes share catalog identity, tenant boundaries, provenance,
freshness, private evidence, and deterministic calculation rules.

Research Projects are the decision hub: they retain candidate products and
markets, saved evidence references, dated assumptions, linked research outputs,
and immutable Decision Memos. A memo snapshots its source IDs when created, so
later observations do not silently rewrite a historic go/no-go decision.

## Product principles

- Correctness and explainability take priority over feature count.
- AI may suggest column mappings, candidates, and explanations; it cannot calculate financial outputs.
- Every product decision must expose source evidence, timestamps, assumptions, and unresolved risks.
- A case, pack, or unit contradiction blocks automatic acceptance.
- Raw provider observations and derived research assessments are separate
  records. A score always cites its input observations and calculation version.

## Phase 1 scope

Phase 1 adds supplier-catalog ingestion through private object storage. It supports CSV, XLSX, and XLS inspection; bounded sheet/header previews; explicit mapping; persisted normalized rows; GS1 check-digit warnings; and a saved VSI mapping profile. Identifiers remain strings throughout ingestion so leading zeroes are preserved.

The proof slice uploads a local file through a short-lived signed URL, runs it through malware scanning and deterministic inspection, persists a selected mapping, then normalizes rows in a checkpointed background job.

## Phase 2 scope

Phase 2 adds deterministic catalog matching after normalization. It cascades from supplied ASIN to exact UPC/EAN/GTIN, MPN plus brand, and title candidates. Candidates retain feature-level evidence, confidence, provider provenance, and freshness. Brand, model, size, pack, or variation contradictions cannot auto-accept. PackGuard prevents downstream profitability when case-to-sellable pack data is unknown or contradictory.

## Phase 4 scope

Phase 4 adds an idempotent, tenant-scoped calculation stage after enrichment. A configured financial policy, dated shipping route, verified PackGuard result, and fresh price, fee, history, and restriction evidence are required. It stores Decimal/NUMERIC scenario outputs and evidence snapshots. Missing or unsupported fee evidence remains explicit `PARTIAL_SUCCESS`; it never becomes an optimistic profit estimate.

## Phase 5 scope

Phase 5 adds a server-windowed analysis workspace with a virtualized grid, filters, saved views, typed inline cost/stress assumptions, bounded bulk recalculation, evidence inspection, and read-only decision replay. Overrides are versioned and reasoned; they never mutate supplier source rows or provider evidence.

## Phase 6 scope

Phase 6 adds organization-scoped shortlists, research statuses, notes, workflow audit events, and a case-aware purchase-order draft. A PO copies a selected current, verified scenario and uses Decimal-only carton/MOQ rounding from supplier-owned, timestamped ordering rules. Validation recalculates every line and total before export. Exports are private, asynchronous CSV/XLSX artifacts with formula-safe textual cells, selected-scenario audit evidence, checksums, expiry, and short-lived downloads.

## Future workflow

`upload → inspect/map → normalize → match → enrich → calculate → review → shortlist → purchase order`

## Phase 7 scope

Phase 7 adds a private-production boundary: authenticated owner access, fail-closed production configuration, private deployment guidance, redacted structured logs and worker metrics, recovery/backup procedures, report-first export retention, and production-like security/fault/load test contracts. The two-week real-scan pilot remains an operational exit criterion, not an automated claim.

The canonical scan state machine is documented in [Architecture](ARCHITECTURE.md).

## Phase 7.5B Slice 1 scope

Slice 1 introduces the RizPoint application shell and an honest dashboard. The dashboard shows only persisted, organization-scoped catalog scan counts and recent job state; it does not infer commercial metrics. The shell provides responsive navigation, accessible feedback primitives, and clear placeholders for workflows that need a selected scan or later Phase 8 administration.

## Phase 7.6 scope

Slices 2–4 add optional, authorized SP-API catalog, competitive-offer, fee, and
listing-restriction evidence behind typed provider contracts. Mock mode remains
the default. Every provider value is persisted with its provider, operation,
marketplace, observation time, freshness/completeness state, request lineage,
and private raw-evidence reference. Unknown, throttled, unauthorized, partial,
and unavailable data remain distinct; FBA is fulfillment, not Amazon Retail.

Slice 6 presents those persisted facts in the server-windowed analysis workspace.
Its active-view CSV/XLSX exports are private, formula-safe snapshots of the same
typed server filters used by the grid. Evidence refreshes are checkpointed,
organization-scoped jobs and preserve explicit queued, partial, and failed
states. Licensed historical enrichment is optional and separately checkpointed;
it never blocks a wholesale scan unless a future policy explicitly requires it.

## Research foundation scope

The research foundation adds organization-scoped projects for private-label,
wholesale, and manual-ASIN work. Projects may contain existing catalog products,
keywords, versioned market definitions, tags, notes, watches, opportunity
assessments, and alert foundations. Marketplace- and time-specific research
observations use a shared provenance envelope with typed keyword, product-market,
category, brand, and seller projections.

This foundation does not add a full research UI, claim live keyword coverage, or
infer unavailable metrics. Licensed provider selection beyond optional history,
research calculation engines, and broader research workflows remain later
prompts.

## Licensed market history

Prompt 04 adds an optional, vendor-neutral market-history boundary. The first
implementation is a Keepa adapter selected only with
`MARKET_HISTORY_PROVIDER_MODE=keepa` and an encrypted `keepa` / `api_key`
credential. The default recorded adapter is explicitly `MOCK`. Bounded refresh
runs persist append-only price, sales-rank, offer-count, Amazon-availability,
rating/review, first-observed, and category-context points when returned.
Missing fields remain absent, not zero. Historical evidence is optional for
wholesale calculations and is shown with provider, observation time, freshness,
and completeness.

## History analytics

Prompt 05 derives versioned, deterministic research metrics from normalized,
provider-scoped history only. The product evidence History tab keeps raw points
separate from descriptive 30/90/180/365-day price, rank, offer, availability,
review, listing-age, and seasonality analysis. Every derived snapshot names its
calculation version, input points, provider, window, coverage, and confidence.
Missing dates are never filled, BSR never becomes a sales estimate, and sparse
history remains partial or insufficient rather than becoming a clean score.

## Product Explorer

Prompt 06 adds Product Explorer, a server-windowed discovery surface over an
organization's existing evidence universe: accepted/imported products, research
project items, active watches, market members, and history-refresh subjects.
It is not a claim to a global Amazon catalog. Filters are available only for
typed, stored observations such as identity, observed price, review count, and
history analytics; unavailable demand, concentration, variation, opportunity,
and private-label profit metrics remain visibly unavailable. Explorer products
can be compared, saved to projects, watched, exported as a formula-safe
authorized CSV window, and saved as reusable views.

## Category Intelligence

Prompt 07 adds a Category Intelligence browser and category detail pages over
the same organization-scoped evidence universe as Product Explorer. Category
labels are observed product-type values, so the browser is a tracked-universe
tree rather than a claimed Amazon taxonomy. Pages name their member universe,
generation time, and bounded deterministic analysis window. They provide
observed median price/reviews, review barrier, price stability, brand HHI,
Amazon Retail, listing-age, seasonality, opportunity, and review-growth views.
No licensed category demand provider is connected: market size, revenue/units,
seller concentration, and sales growth are explicitly unavailable. Categories
can be added to existing research projects or saved as a dynamic
tracked-universe category watch.

## Opportunity Finder

Prompt 08 adds deterministic niche definitions and immutable score snapshots.
Niches may use stored keyword evidence, a category, a manual tracked competitor
set, or an existing market definition. Scores expose every component, thresholds,
confidence, calculation version, and product/history input reference. Low
coverage reduces confidence and the final score; unavailable demand, sales,
sponsored density, seller concentration, and margin inputs stay unavailable.

## Sales estimation

Prompt 09 adds monthly-unit ranges from either a licensed provider or an exact
marketplace/category calibration backed by a named reference dataset. Provider
and RizPoint-modeled estimates remain distinct. Every stored result includes a
source, model version, confidence/range, input fingerprint, provenance
references, and observation time. With no validated runtime calibration or
licensed estimate, the UI returns an explicit unavailable reason.

## Provider runtime foundation

Every provider capability now has an organization/marketplace-scoped runtime
state. `MOCK` and `LIVE` are explicit origins. A missing entitlement,
authorization failure, exhausted credit window, throttle, outage, or partial
response is a first-class reason for unavailable data; it is never converted to
zero. Licensed history, keyword, category, brand, seller, advertising, and
review providers are not selected or enabled by this foundation.

## Seller Intelligence

Prompt 16 adds an entitlement-gated Seller & Competitor workspace over
organization-scoped `SellerObservation` records. Seller identity, product count,
and any provider metrics retain their observation source, timestamp, and
completeness. No seller storefront scraping or personal-data enrichment is
performed; absent licensed data leaves this optional workspace unavailable
without affecting product research.

## Product relationships

Prompt 17 adds a product-neighborhood query and accessible table view. In the
absence of a licensed relationship provider, it derives only shared-keyword and
shared-saved-market similarity from organization evidence. Each result is
explicitly labeled `DERIVED`; no behavioral Amazon relationship is inferred.

## Advertising Intelligence

Prompt 18 provides an optional `AdvertisingIntelligenceProvider` contract and
capability-gated workspace. Sponsored placement, share-of-voice, and CPC
metrics are unavailable until an entitled licensed or authorized first-party
source supplies them; the product never scrapes sponsored placements or shows
mock observations as live.

## Review Intelligence

Prompt 19 accepts only licensed, user-imported, or otherwise authorized review
records. It deduplicates redacted text, stores source/timestamp/rating, and
builds deterministic, versioned theme summaries with review-ID evidence links.
Review text is not scraped from Amazon pages; contact and order-like references
are minimized before persistence.

## Product Differentiation

Prompt 20 turns review themes and available structured catalog evidence into an
exportable Differentiation Brief. Raw evidence and validation hypotheses remain
visually and semantically distinct; every hypothesis includes its linked review
signals and a confidence level. Missing licensed market inputs remain listed as
unavailable rather than inferred.

## Listing Analyzer

Prompt 21 adds a deterministic Listing Analyzer that compares the catalog's
authorized current title/known metadata with an editable draft. Versioned,
saved assessments decompose each checklist score and source references. Keyword
coverage is a copy-presence check—not an Amazon ranking claim—and SEO
opportunities are visibly separate from conservative compliance-risk warnings.

## Listing Builder

Prompt 22 adds ResearchProject-scoped verified ProductFacts, versioned listing
drafts, and per-section claim/evidence mappings. The deterministic builder uses
only fact values and supplied keywords. Drafts with unverified claims cannot be
approved by the API; keyword-stuffing and configured constraints remain visible
as warnings rather than fabricated content.

## Private-Label Launch Planner

Prompt 23 adds a persisted, dependency-gated launch plan connected to one exact
ResearchProject evidence snapshot. Plans capture research versions, target
keywords, known competitor/watches, owners, due dates, budgets, KPIs,
assumptions, risks, stage evidence, and an append-only change log. Missing
market-price, PPC, and margin inputs remain unavailable, and the planner makes
no external purchase or Seller Central change.

## Private-Label Profitability

Prompt 24 adds versioned EXW/FOB/DDP supplier-quote scenarios to private-label
ResearchProjects. A separate Decimal engine compares complete, sourced cost
registers, explicit currency conversion observations, MOQ cash exposure,
landed cost, profit/ROI/margin, mathematical break-even thresholds, waterfall
allocations, and named price/cost stresses. The wholesale engine and its
`profit-engine/v3` formulas remain unchanged.

## Compliance Risk Screen

Prompt 25 adds a research-stage Compliance Risk screen driven only by
organization-scoped, curated, versioned rules. It produces a per-domain
`LOW`/`REVIEW`/`HIGH`/`UNKNOWN` screen with source links/dates, supplier
questions, documentation to verify, and an explicit launch hold. An unmatched
domain stays `UNKNOWN`; no configured coverage is never represented as a safe
product. Ruleset updates create a new version and preserve past assessments.
The screen is not legal advice and does not say a certification is unnecessary.
Authorized Amazon seller-restriction observations are shown only as seller
eligibility evidence, never as compliance clearance.

## Portfolio & Cash Allocation

Prompt 26 adds an explainable portfolio optimizer for project-owned candidate
products. It allocates integer MOQ/case-pack quantities under cash, ASIN, brand,
category, demand, economics, confidence, seasonality, compliance, volatility,
competition, lead-time, and inventory-day constraints. Every exclusion and
constraint result is visible. Base and five explicit stress modes produce a
recommended portfolio plus alternatives, expected profit ranges,
diversification, and risk concentration. The bounded Decimal branch-and-bound
solver is deterministic and fails closed when it cannot prove optimality; an
LLM never selects or calculates the portfolio.
